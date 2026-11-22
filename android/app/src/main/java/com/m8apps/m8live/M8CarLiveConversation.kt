package com.m8apps.m8live

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioManager
import android.media.AudioTrack
import android.util.Base64
import android.util.Log
import androidx.car.app.CarContext
import androidx.car.app.media.CarAudioRecord
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import java.net.URLEncoder
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean

class M8CarLiveConversation(
  private val carContext: CarContext,
  private val onStatus: (String) -> Unit,
  private val onBytes: (Int) -> Unit,
  private val onTranscript: (String) -> Unit,
) {
  private val client = OkHttpClient.Builder()
    .readTimeout(0, TimeUnit.MILLISECONDS)
    .pingInterval(20, TimeUnit.SECONDS)
    .build()

  private val active = AtomicBoolean(false)
  private var webSocket: WebSocket? = null

  fun isActive(): Boolean = active.get()

  fun stop() {
    active.set(false)
    try { webSocket?.close(1000, "stopped") } catch (_: Throwable) {}
    webSocket = null
  }

  fun startOneTurn() {
    if (!active.compareAndSet(false, true)) return
    Thread { runOneTurn() }.start()
  }

  private fun runOneTurn() {
    var carAudioRecord: CarAudioRecord? = null
    var ownedAudioTrack: AudioTrack? = null
    try {
      onStatus("Connecting to M8 Live")
      val setupLatch = CountDownLatch(1)
      val doneLatch = CountDownLatch(1)
      val audioTrack = createAudioTrack()
      ownedAudioTrack = audioTrack
      fun applySampleRate(rate: Int) {
        if (rate != audioTrack.sampleRate) {
          check(audioTrack.setPlaybackRate(rate) == AudioTrack.SUCCESS) { "PCM playback rate is unavailable" }
        }
      }
      var capturedBytes = 0
      var modelText = ""

      val req = Request.Builder().url(buildWebSocketUrl()).build()
      webSocket = client.newWebSocket(req, object : WebSocketListener() {
        override fun onOpen(ws: WebSocket, response: Response) {
          Log.i(TAG, "car live websocket open")
          ws.send(setupJson())
        }

        override fun onMessage(ws: WebSocket, text: String) {
          try {
            val msg = JSONObject(text)
            if (msg.has("error")) {
              onStatus("M8 could not finish. Start another conversation to retry.")
              active.set(false)
              setupLatch.countDown()
              doneLatch.countDown()
              return
            }
            if (msg.has("setupComplete")) {
              val announced = msg.optJSONObject("setupComplete")?.optInt("sampleRate", 0) ?: 0
              applySampleRate(M8PcmFormat.fromSetup(announced, audioTrack.sampleRate))
              setupLatch.countDown()
              return
            }
            if (msg.has("goAway")) {
              doneLatch.countDown()
              return
            }
            val sc = msg.optJSONObject("serverContent") ?: return
            val outT = sc.optJSONObject("outputTranscription")?.optString("text").orEmpty()
            if (outT.isNotBlank()) {
              modelText += outT
              onTranscript(modelText)
            }
            val parts = sc.optJSONObject("modelTurn")?.optJSONArray("parts")
            if (parts != null) {
              for (i in 0 until parts.length()) {
                val inline = parts.optJSONObject(i)?.optJSONObject("inlineData") ?: continue
                val mime = inline.optString("mimeType")
                val data = inline.optString("data")
                if (mime.startsWith("audio/pcm") && data.isNotBlank()) {
                  applySampleRate(M8PcmFormat.fromMime(mime, audioTrack.sampleRate))
                  val pcm = Base64.decode(data, Base64.DEFAULT)
                  audioTrack.write(pcm, 0, pcm.size)
                }
              }
            }
            if (sc.optBoolean("turnComplete")) doneLatch.countDown()
          } catch (t: Throwable) {
            Log.w(TAG, "car live message parse failed", t)
          }
        }

        override fun onFailure(ws: WebSocket, t: Throwable, response: Response?) {
          Log.e(TAG, "car live websocket failed", t)
          onStatus("M8 connection error")
          doneLatch.countDown()
          setupLatch.countDown()
        }

        override fun onClosed(ws: WebSocket, code: Int, reason: String) {
          Log.i(TAG, "car live websocket closed code=$code reason=$reason")
          doneLatch.countDown()
        }
      })

      if (!setupLatch.await(12, TimeUnit.SECONDS)) throw IllegalStateException("Gemini setup timeout")
      if (!active.get()) return

      onStatus("Listening to Boss")
      carAudioRecord = CarAudioRecord.create(carContext)
      val buffer = ByteArray(CarAudioRecord.AUDIO_CONTENT_BUFFER_SIZE)
      carAudioRecord.startRecording()
      val deadline = System.currentTimeMillis() + 5500
      while (active.get() && System.currentTimeMillis() < deadline) {
        val read = carAudioRecord.read(buffer, 0, buffer.size)
        if (read > 0) {
          capturedBytes += read
          val b64 = Base64.encodeToString(buffer.copyOf(read), Base64.NO_WRAP)
          webSocket?.send(audioJson(b64))
        }
      }
      onBytes(capturedBytes)
      Log.i(TAG, "Sent car mic audio to M8 bytes=$capturedBytes sampleRate=${CarAudioRecord.AUDIO_CONTENT_SAMPLING_RATE}")
      onStatus("M8 is answering")
      webSocket?.send("{\"realtimeInput\":{\"audioStreamEnd\":true}}")

      doneLatch.await(30, TimeUnit.SECONDS)
      onStatus(if (modelText.isBlank()) "Ready" else "Ready — answered by voice")
    } catch (t: Throwable) {
      Log.e(TAG, "car live conversation failed", t)
      onStatus("M8 voice error: ${t.javaClass.simpleName}")
    } finally {
      active.set(false)
      try { carAudioRecord?.stopRecording() } catch (_: Throwable) {}
      try { ownedAudioTrack?.stop() } catch (_: Throwable) {}
      try { ownedAudioTrack?.release() } catch (_: Throwable) {}
      try { webSocket?.close(1000, "turn complete") } catch (_: Throwable) {}
      webSocket = null
    }
  }

  private fun createAudioTrack(): AudioTrack {
    val min = AudioTrack.getMinBufferSize(24000, AudioFormat.CHANNEL_OUT_MONO, AudioFormat.ENCODING_PCM_16BIT)
    val attrs = AudioAttributes.Builder()
      .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
      .build()
    val format = AudioFormat.Builder()
      .setSampleRate(24000)
      .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
      .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
      .build()
    val track = AudioTrack(attrs, format, min.coerceAtLeast(24_000), AudioTrack.MODE_STREAM, AudioManager.AUDIO_SESSION_ID_GENERATE)
    track.play()
    return track
  }

  private fun buildWebSocketUrl(): String {
    val base = BuildConfig.M8LIVE_PROXY_URL.trim().ifBlank { "https://live.m8apps.com" }.removeSuffix("/")
    val wsBase = base.replaceFirst("https://", "wss://").replaceFirst("http://", "ws://")
    val token = BuildConfig.M8LIVE_DEVICE_TOKEN.trim()
    val encoded = URLEncoder.encode(token, "UTF-8")
    return if (token.isBlank()) "$wsBase/gemini" else "$wsBase/gemini?device_token=$encoded"
  }

  private fun setupJson(): String {
    return JSONObject()
      .put("setup", JSONObject()
        .put("model", "models/gemini-3.1-flash-live-preview")
        .put("generation_config", JSONObject()
          .put("response_modalities", JSONArray().put("AUDIO"))
          .put("speech_config", JSONObject()
            .put("voice_config", JSONObject()
              .put("prebuilt_voice_config", JSONObject().put("voice_name", "Zephyr")))))
        .put("realtime_input_config", JSONObject()
          .put("automatic_activity_detection", JSONObject()
            .put("disabled", false)
            .put("start_of_speech_sensitivity", "START_SENSITIVITY_HIGH")
            .put("end_of_speech_sensitivity", "END_SENSITIVITY_HIGH")
            .put("silence_duration_ms", 220)
            .put("prefix_padding_ms", 60)))
        .put("system_instruction", JSONObject()
          .put("parts", JSONArray().put(JSONObject().put("text", "You are M8 in Android Auto. Call the user Boss. Reply by voice only. Be concise, natural, and conversational. Do not say you sent a message. Keep driving context short and useful."))))
        .put("input_audio_transcription", JSONObject())
        .put("output_audio_transcription", JSONObject()))
      .toString()
  }

  private fun audioJson(b64: String): String {
    val rate = CarAudioRecord.AUDIO_CONTENT_SAMPLING_RATE
    return JSONObject()
      .put("realtimeInput", JSONObject()
        .put("audio", JSONObject()
          .put("data", b64)
          .put("mimeType", "audio/pcm;rate=$rate")))
      .toString()
  }

  companion object { private const val TAG = "M8CarLive" }
}
