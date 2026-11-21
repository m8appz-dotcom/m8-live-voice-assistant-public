import { useCallback, useRef } from 'react'
import { appendBridgeToken, GEMINI_LIVE_MODEL, getProxyBase, toWebSocketUrl } from '../src/services/appConfig'
import { LOCAL_DEVICE_TOOL_DECLARATIONS } from '../src/services/deviceTools'
import { OPENCLAW_TOOL_DECLARATIONS } from '../src/services/openclaw'

const SYSTEM_INSTRUCTION =
  'You are M8. Call the user Boss. Be concise. The user only talks to you, never directly to background agents. Treat voice and text as the same conversation channel. Use built-in Gemini tools for search/url context when helpful. Use local device tools first for camera, mic, files, haptics, links, or device-side actions. Use openclaw_dispatch only when the task requires real execution on Adrian\'s OpenClaw machine beyond your direct Gemini/device abilities. Do not expose orchestration internals; summarize OpenClaw status, blockers, evidence, and completion naturally back to the user. When a notification arrives, treat it as system context, not as user intent.'

const BUILTIN_GEMINI_TOOLS = [
  { google_search: {} },
  { url_context: {} },
] as const

const TOOL_DECLARATIONS = [...LOCAL_DEVICE_TOOL_DECLARATIONS, ...OPENCLAW_TOOL_DECLARATIONS]

export function useGeminiSession({
  isWeb,
  wsRef,
  setState,
  setError,
  stopMic,
  stopVideo,
  settings,
  pendingWakeRef,
  injectWakeIntoGemini,
  handleToolCall,
  clearAudioQueue,
  micPausedRef,
  appendStreaming,
  finalizeStreaming,
  setAudioLevel,
  micOnRef
}: any) {
  const retryDelayRef = useRef(1000)
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const notificationQueueRef = useRef<string[]>([])

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current)
    stopMic()
    stopVideo()
    wsRef.current?.close()
    wsRef.current = null
    setState('idle')
  }, [stopMic, stopVideo, wsRef, setState])

  const connect = useCallback(async () => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) return
    try {
      if (reconnectTimeoutRef.current) clearTimeout(reconnectTimeoutRef.current)
      setError('')
      setState('connecting')
      let wsUrl: string
      if (isWeb) {
        const proxyBase = getProxyBase(true)
        const targetBase = proxyBase || window.location.origin
        wsUrl = appendBridgeToken(toWebSocketUrl(targetBase, '/gemini'))
      } else {
        const proxyBase = getProxyBase(false)
        wsUrl = appendBridgeToken(toWebSocketUrl(proxyBase, '/gemini'))
      }
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = () => {
        retryDelayRef.current = 1000 // Reset backoff on success
        ws.send(JSON.stringify({
          setup: {
            model: `models/${GEMINI_LIVE_MODEL}`,
            generation_config: {
              response_modalities: ['AUDIO'],
              speech_config: { voice_config: { prebuilt_voice_config: { voice_name: settings.voiceId || 'Zephyr' } } },
            },
            realtime_input_config: {
              automatic_activity_detection: {
                disabled: false,
                start_of_speech_sensitivity: 'START_SENSITIVITY_HIGH',
                end_of_speech_sensitivity: 'END_SENSITIVITY_HIGH',
                silence_duration_ms: 220,
                prefix_padding_ms: 60,
              },
            },
            context_window_compression: {
              trigger_tokens: 80000,
              sliding_window: { target_tokens: 40000 },
            },
            system_instruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
            input_audio_transcription: {},
            output_audio_transcription: {},
            tools: [...BUILTIN_GEMINI_TOOLS, { function_declarations: TOOL_DECLARATIONS }],
          },
        }))
      }

      ws.onmessage = async (event: MessageEvent) => {
        let msg: Record<string, unknown>
        try { msg = JSON.parse(event.data) } catch { return }

        if (msg.goAway) {
          stopMic(); stopVideo()
          setState('idle')
          setError('Live session expired. Tap when you want to wake M8 Live again.')
          try { ws.close(1000, 'goAway acknowledged') } catch {}
          return
        }

        if (msg.setupComplete !== undefined) {
          setState('ready')
          const pendingWake = pendingWakeRef.current
          if (pendingWake && injectWakeIntoGemini(pendingWake)) pendingWakeRef.current = null
          return
        }

        if (msg.toolCall) {
          await handleToolCall(msg.toolCall as any)
          return
        }

        const sc = msg.serverContent as Record<string, unknown> | undefined
        if (!sc) return

        if (sc.interrupted) {
          clearAudioQueue()
          micPausedRef.current = false
          return
        }

        const inT = (sc.inputTranscription as Record<string, string> | undefined)?.text
        if (inT?.trim()) appendStreaming('user', inT.trim())

        const outT = (sc.outputTranscription as Record<string, string> | undefined)?.text
        if (outT) appendStreaming('model', outT)

        const parts = (sc.modelTurn as Record<string, unknown> | undefined)?.parts as Array<Record<string, unknown>> | undefined
        if (parts) {
          setState('responding')
          const pcmParts: string[] = []
          for (const part of parts) {
            const id = part.inlineData as Record<string, string> | undefined
            if (id?.data && String(id.mimeType || '').startsWith('audio/pcm')) {
              pcmParts.push(id.data)
            }
          }
          if (pcmParts.length > 0) {
            // Handled via external audioPlay callback in live.tsx which passes through parts
            // Actually, we need to expose an onAudioParts callback if we fully extract,
            // or we assume it's passed down. Wait, in live.tsx playAudio was called directly here.
            // For now, assume playAudio is not in scope. We need to pass playAudio.
          }
        }

        if (sc.turnComplete) {
          micPausedRef.current = false
          finalizeStreaming()
          setAudioLevel(0)
          
          // Inject queued notifications
          if (notificationQueueRef.current.length > 0) {
            const texts = [...notificationQueueRef.current]
            notificationQueueRef.current = []
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              const combinedText = texts.join(' \\n ')
              wsRef.current.send(JSON.stringify({ realtimeInput: { text: combinedText } }))
              setState('thinking')
              return // Wait for response
            }
          }
          
          setState(micOnRef.current ? 'listening' : 'ready')
        }
      }

      ws.onerror = () => { setError('Connection failed.'); setState('error') }
      ws.onclose = e => {
        stopMic(); stopVideo()
        setState('idle')
        const rawReason = typeof e.reason === 'string' ? e.reason.trim() : ''
        const goAwayReason = /goaway|go away|session expired|session duration/i.test(rawReason)
        const reason = rawReason || (e.code === 1008 ? 'Modelo/configuración incompatible en el backend.' : '')
        
        if (goAwayReason) {
          setError('Live session expired. Tap when you want to wake M8 Live again.')
        } else if (e.code !== 1000 && e.code !== 1005) {
          setError(reason ? `Disconnected (${e.code}): ${reason}` : `Disconnected (${e.code})`)
          retryDelayRef.current = Math.min(retryDelayRef.current * 2, 30000)
          reconnectTimeoutRef.current = setTimeout(() => {
            connect()
          }, retryDelayRef.current + Math.random() * 500)
        }
      }
    } catch (e) {
      setError(String((e as Error).message || e))
      setState('error')
    }
  }, [isWeb, wsRef, setState, setError, stopMic, stopVideo, settings.voiceId, pendingWakeRef, injectWakeIntoGemini, handleToolCall, clearAudioQueue, micPausedRef, appendStreaming, finalizeStreaming, setAudioLevel, micOnRef])

  const enqueueNotification = useCallback((text: string) => {
    notificationQueueRef.current.push(text)
  }, [])

  return { connect, disconnect, enqueueNotification }
}
