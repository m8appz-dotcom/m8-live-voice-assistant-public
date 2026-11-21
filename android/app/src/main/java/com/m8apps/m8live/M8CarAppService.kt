package com.m8apps.m8live

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.media.AudioAttributes
import android.media.AudioFocusRequest
import android.media.AudioManager
import android.os.Build
import android.util.Log
import androidx.car.app.CarAppService
import androidx.car.app.CarContext
import androidx.car.app.Screen
import androidx.car.app.Session
import androidx.car.app.media.CarAudioRecord
import androidx.car.app.model.Action
import androidx.car.app.model.Pane
import androidx.car.app.model.PaneTemplate
import androidx.car.app.model.Row
import androidx.car.app.model.Template
import androidx.car.app.validation.HostValidator
import androidx.core.content.ContextCompat

class M8CarAppService : CarAppService() {
  override fun createHostValidator(): HostValidator {
    // Development/test shell only. Tighten host validation before Play release.
    return HostValidator.ALLOW_ALL_HOSTS_VALIDATOR
  }

  override fun onCreateSession(): Session = M8CarSession()
}

class M8CarSession : Session() {
  override fun onCreateScreen(intent: Intent): Screen = M8CarScreen(carContext)
}

class M8CarScreen(carContext: CarContext) : Screen(carContext) {
  private var micState: String = "Idle"
  private var lastMicBytes: Int = 0
  private var recording = false
  private var focusRequest: AudioFocusRequest? = null
  private var conversation: M8CarLiveConversation? = null
  private var lastReply: String = ""

  override fun onGetTemplate(): Template {
    val active = conversation?.isActive() == true
    val pane = Pane.Builder()
      .addRow(
        Row.Builder()
          .setTitle(if (active) "M8 is live" else "M8 Assistant")
          .addText(primaryStatusLine(active))
          .addText(if (active) "Speak now. M8 will answer by voice." else "Tap Talk to M8 for a voice turn.")
          .build()
      )
      .addRow(
        Row.Builder()
          .setTitle("Voice answer")
          .addText(lastReply.ifBlank { "Responses play through car speakers." }.take(90))
          .addText(if (lastMicBytes > 0) "Mic sent $lastMicBytes bytes" else "Bottom mic remains Google/Gemini.")
          .build()
      )
      .addAction(
        Action.Builder()
          .setTitle(if (active) "Stop" else "Talk to M8")
          .setOnClickListener {
            if (conversation?.isActive() == true) {
              conversation?.stop()
              micState = "Stopped"
              invalidate()
            } else {
              startM8LiveTurn()
            }
          }
          .build()
      )
      .addAction(
        Action.Builder()
          .setTitle("Reset")
          .setOnClickListener {
            conversation?.stop()
            lastReply = ""
            lastMicBytes = 0
            micState = "Ready"
            invalidate()
          }
          .build()
      )
      .build()

    return PaneTemplate.Builder(pane)
      .setTitle("M8 Live")
      .setHeaderAction(Action.APP_ICON)
      .build()
  }

  private fun primaryStatusLine(active: Boolean): String {
    val state = micState.ifBlank { "Ready" }
    return when {
      active && state.startsWith("Listening") -> "Listening to Boss"
      active && state.startsWith("M8 is answering") -> "M8 is speaking"
      active && state.startsWith("Connecting") -> "Connecting to M8 Live"
      active -> state
      lastReply.isNotBlank() -> "Ready for the next voice turn"
      else -> "Ready"
    }.take(90)
  }


  private fun startM8LiveTurn() {
    if (ContextCompat.checkSelfPermission(carContext, Manifest.permission.RECORD_AUDIO) != PackageManager.PERMISSION_GRANTED) {
      micState = "Permission needed"
      invalidate()
      carContext.requestPermissions(listOf(Manifest.permission.RECORD_AUDIO), carContext.mainExecutor) { granted, rejected ->
        Log.i(TAG, "Car mic permission granted=$granted rejected=$rejected")
        if (granted.contains(Manifest.permission.RECORD_AUDIO)) startM8LiveTurn() else {
          micState = "Permission rejected"
          invalidate()
        }
      }
      return
    }

    val audioManager = carContext.getSystemService(AudioManager::class.java)
    val attrs = AudioAttributes.Builder()
      .setContentType(AudioAttributes.CONTENT_TYPE_SPEECH)
      .setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE)
      .build()
    val req = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
        .setAudioAttributes(attrs)
        .setOnAudioFocusChangeListener { change -> if (change == AudioManager.AUDIOFOCUS_LOSS) conversation?.stop() }
        .build()
    } else null
    val focusGranted = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      audioManager.requestAudioFocus(req!!) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    } else {
      @Suppress("DEPRECATION")
      audioManager.requestAudioFocus(null, AudioManager.STREAM_MUSIC, AudioManager.AUDIOFOCUS_GAIN_TRANSIENT) == AudioManager.AUDIOFOCUS_REQUEST_GRANTED
    }
    if (!focusGranted) {
      micState = "Audio focus denied"
      invalidate()
      return
    }
    focusRequest = req
    lastReply = ""
    lastMicBytes = 0
    micState = "Starting conversation"
    invalidate()

    conversation = M8CarLiveConversation(
      carContext,
      onStatus = { status ->
        carContext.mainExecutor.execute {
          micState = status
          invalidate()
          if (!status.startsWith("Listening") && !status.startsWith("M8 is answering") && !status.startsWith("Connecting")) {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
              focusRequest?.let { audioManager.abandonAudioFocusRequest(it) }
            } else {
              @Suppress("DEPRECATION")
              audioManager.abandonAudioFocus(null)
            }
          }
        }
      },
      onBytes = { bytes ->
        carContext.mainExecutor.execute {
          lastMicBytes = bytes
          invalidate()
        }
      },
      onTranscript = { text ->
        carContext.mainExecutor.execute {
          lastReply = text.takeLast(120)
          invalidate()
        }
      }
    )
    conversation?.startOneTurn()
  }

  companion object {
    private const val TAG = "M8CarAppService"
  }
}
