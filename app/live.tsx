import {PlaybackDrain} from '../src/audio/playbackDrain'
import { ThreeOrb, PulseBadge, AudioSpectrum } from '../components/LiveVisuals'
import { hostedWorkspace } from '../src/services/hostedWorkspace'
import type { SessionState } from '../src/types/session'
import { pcmPlaybackDeadlineMs } from '../src/audio/playbackTiming'
import { b64ToArrayBuffer, pcm16ToAudioBuffer, downsample, pcm16ToB64, concatPcmB64, calcPcmRms } from '../src/audio/pcm'
import { useEffect, useRef, useState, useCallback, type ComponentRef } from 'react'
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, Modal, Switch, KeyboardAvoidingView, Keyboard, Animated as RNAnimated } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import NativeOrb from '../components/NativeOrb'
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera'
import { useAudioRecorder } from '@siteed/audio-studio'
import type { AudioDataEvent } from '@siteed/audio-studio'
import {createAudioPlayer,setAudioModeAsync} from 'expo-audio'
import * as FileSystem from 'expo-file-system/legacy'
import * as DocumentPicker from 'expo-document-picker'
import * as Haptics from 'expo-haptics'
import { useSettings } from '../src/stores/settings'
import { Ionicons } from '@expo/vector-icons'
import { appendBridgeToken, GEMINI_LIVE_MODEL, getProxyBase, toWebSocketUrl } from '../src/services/appConfig'
import { LOCAL_DEVICE_TOOL_DECLARATIONS, invokeLocalDeviceTool, isLocalDeviceTool } from '../src/services/deviceTools'
import { connectAppEventStream } from '../src/services/eventStream'
import { createBridgeSession, getBridgeSessionStatus } from '../src/services/bridgeSession'
import { authenticateBridgePasskey, isPasskeySupported, registerBridgePasskey } from '../src/services/passkey'
import { decideNotificationHandling } from '../src/services/notificationPolicy'
import { OPENCLAW_TOOL_DECLARATIONS, invokeOpenClawTool, isOpenClawTool } from '../src/services/openclaw'
import { MEMORY_TOOL_DECLARATIONS, fetchMemoryContext, formatLocalMemory, getLocalMemory, invokeMemoryTool, isMemoryTool, rememberLocalTurn } from '../src/services/memory'
import { MESSAGE_TOOL_DECLARATIONS, invokeMessageTool, isMessageTool } from '../src/services/messages'
import { ackWake, fetchWake, type WakeRecord } from '../src/services/wake'
import type { AppEvent } from '../src/types/realtime'

type ChatRole = 'user' | 'model'
type ChatItem = { id: string; role: ChatRole; text: string; meta?: Record<string, unknown> }

type VideoMode = 'none' | 'camera' | 'screen'

const SYSTEM_INSTRUCTION = `You are M8, Boss's personal live operator. Call the user Boss. Spanish first unless Boss uses English. Be concise, calm, and direct.

Operating rules:
- Voice and text are the same conversation. Keep spoken answers short and useful.
- Do not invent results, logs, memory, tool output, delivery, or completion. If you do not know, say what you know and what you are checking.
- Before answering about Boss's preferences, prior decisions, active projects, pending tasks, recurring errors, or "what happened earlier", use memory_search unless the answer is already in the current turn.
- Save durable preferences, decisions, tasks, blockers, repeated errors, and project facts with memory_save. Never save secrets, keys, passwords, tokens, or private credentials.
- Use built-in Gemini tools for web search/url context when helpful. Use local device tools first for camera, mic, files, haptics, links, location, or device-side actions.
- For Android device operation, use an observe → act → verify loop: read android_screen_tree, prefer android_click_text over raw coordinates, wait for visible confirmation with android_wait_for_text, then report only verified state.
- Use message tools only when Boss explicitly asks to read/search private messages. Prefer source status first if unsure. Never read private message bodies proactively.
- Use openclaw_dispatch only when the task requires real execution on Adrian's OpenClaw machine beyond your Gemini/device abilities.
- When using OpenClaw, tell Boss naturally if work is queued/running/blocked/done. If a remote call fails, check memory/log/status when possible before claiming failure.
- Ask confirmation before destructive actions, public/external sends, purchases, irreversible changes, or anything privacy-sensitive.
- Boss talks to you, not to background agents. Do not expose orchestration internals unless Boss asks. Summarize status, blockers, evidence, and completion naturally.
- Notifications and wakes are system context, not user intent; read or act on them only as instructed.`

const BUILTIN_GEMINI_TOOLS = [
  { google_search: {} },
  { url_context: {} },
] as const

const TOOL_DECLARATIONS = [...LOCAL_DEVICE_TOOL_DECLARATIONS, ...OPENCLAW_TOOL_DECLARATIONS, ...MEMORY_TOOL_DECLARATIONS, ...MESSAGE_TOOL_DECLARATIONS]

function uid(p = 'msg') { return `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }

function canvasToB64(canvas: HTMLCanvasElement, quality = 0.7): string {
  const dataUrl = canvas.toDataURL('image/jpeg', quality)
  return dataUrl.split(',')[1]
}

export default function LiveScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const params = useLocalSearchParams<{ wakeId?: string | string[] }>()
  const isWeb = Platform.OS === 'web'
  const settings = useSettings()

  const [state, setState] = useState<SessionState>('idle')
  const [chat, setChat] = useState<ChatItem[]>([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [micOn, setMicOn] = useState(false)
  const [videoMode, setVideoMode] = useState<VideoMode>('none')
  const [showPreview, setShowPreview] = useState(false)
  const [cameraFacing, setCameraFacing] = useState<CameraType>('back')
  const [activeTab, setActiveTab] = useState<'orb' | 'chat'>('orb')
  const [audioLevel, setAudioLevel] = useState(0)
  const [speakerMuted, setSpeakerMuted] = useState(false)
  const speakerMutedRef = useRef(false)
  const [dockOffsetY, setDockOffsetY] = useState(0)
  const dockDragStartY = useRef(0)
  const dockDragStartOffset = useRef(0)

  // Keyboard-aware orb sizing
  const orbHeightAnim = useRef(new RNAnimated.Value(1)).current
  const [keyboardVisible, setKeyboardVisible] = useState(false)

  useEffect(() => {
    if (Platform.OS === 'web') return
    const showSub = Keyboard.addListener('keyboardDidShow', () => {
      setKeyboardVisible(true)
      RNAnimated.timing(orbHeightAnim, { toValue: 0, duration: 200, useNativeDriver: false }).start()
    })
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardVisible(false)
      RNAnimated.timing(orbHeightAnim, { toValue: 1, duration: 250, useNativeDriver: false }).start()
    })
    // Fallback: also restore on blur in case keyboardDidHide doesn't fire
    return () => { showSub.remove(); hideSub.remove() }
  }, [])

  // Force restore orb when TextInput loses focus (Android backup for keyboardDidHide)
  const handleInputBlur = useCallback(() => {
    if (Platform.OS !== 'web') {
      setTimeout(() => {
        setKeyboardVisible(false)
        RNAnimated.timing(orbHeightAnim, { toValue: 1, duration: 250, useNativeDriver: false }).start()
      }, 100)
    }
  }, [])

  // Visual controls
  const [micLevel, setMicLevel] = useState(0)
  const [showControls, setShowControls] = useState(false)
  const [ctrlRotSpeed, setCtrlRotSpeed] = useState(1.0)
  const [ctrlDistortion, setCtrlDistortion] = useState(1.3)
  const [ctrlAudioReact, setCtrlAudioReact] = useState(1.0)
  const [bridgeAuthenticated, setBridgeAuthenticated] = useState(!isWeb)
  const [bridgeChecking, setBridgeChecking] = useState(isWeb)
  const [bridgePassword, setBridgePassword] = useState('')
  const [workspaceInvite, setWorkspaceInvite] = useState('')
  const [registrationOpen, setRegistrationOpen] = useState(false)
  const webMicPendingRef = useRef(false)
  const [bridgeAuthBusy, setBridgeAuthBusy] = useState(false)
  const [bridgeAuthError, setBridgeAuthError] = useState('')
  const [passkeySupported, setPasskeySupported] = useState(isWeb ? isPasskeySupported() : false)
  const [passkeyConfigured, setPasskeyConfigured] = useState(false)
  const [passwordConfigured,setPasswordConfigured] = useState(false)
  const [passkeyBusy, setPasskeyBusy] = useState(false)

  // Permissions
  const [cameraPermission, requestCameraPermission] = useCameraPermissions()

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const intentionalDisconnectRef = useRef(false)
  const stateRef = useRef<SessionState>(state)
  const spokenNotificationQueueRef = useRef<string[]>([])
  const spokenNotificationBusyRef = useRef(false)
  const spokenNotificationRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const processSpokenNotificationQueueRef = useRef<() => void>(() => {})
  const audioCtxRef = useRef<AudioContext | null>(null)
  const nextStartRef = useRef(0)
  const playbackDrainRef = useRef(new PlaybackDrain())
  const webSourcesRef = useRef(new Set<AudioBufferSourceNode>())
  const micStreamRef = useRef<MediaStream | null>(null)
  const audioSrcRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const audioProcRef = useRef<ScriptProcessorNode | null>(null)
  const micOnRef = useRef(false)
  const micPausedRef = useRef(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  const videoStreamRef = useRef<MediaStream | null>(null)
  const outputAnalyserRef = useRef<AnalyserNode | null>(null)
  const videoElRef = useRef<HTMLVideoElement | null>(null)
  const videoCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const videoModeRef = useRef<VideoMode>('none')
  const eventStreamCleanupRef = useRef<null | (() => void)>(null)
  const pendingWakeRef = useRef<WakeRecord | null>(null)
  const processedWakeIdRef = useRef<string | null>(null)
  const startMicActionRef = useRef<() => Promise<void>>(async () => {})
  const stopMicActionRef = useRef<() => Promise<void>>(async () => {})
  const startVideoActionRef = useRef<(mode: 'camera' | 'screen') => Promise<void>>(async () => {})
  const stopVideoActionRef = useRef<() => void>(() => {})

  // Native camera ref
  const nativeCameraRef = useRef<CameraView | null>(null)

  // Native audio recorder (hook - always called, guarded by Platform checks inside)
  const { startRecording: startNativeRecording, stopRecording: stopNativeRecording } = useAudioRecorder()

  const modelBufRef = useRef('')
  const userBufRef = useRef('')
  const chatScrollRef = useRef<ComponentRef<typeof ScrollView> | null>(null)
  const micAnimRef = useRef<number>(0)
  const memoryContextRef = useRef('')

  // Native audio queue - buffer with threshold for smooth playback
  const audioQueueRef = useRef<string[]>([])
  const audioPlayingRef = useRef(false)
  const audioModeSetRef = useRef(false)
  const nativePcmBufferRef = useRef<string[]>([])
  const nativePlaybackStartedRef = useRef(false)
  const NATIVE_BUFFER_THRESHOLD = 1
  const NATIVE_BATCH_SIZE = 3
  const playbackRateRef = useRef(24000)
  const nativePlaybackCancelRef = useRef<(() => void) | null>(null)
  const [supportsVision,setSupportsVision] = useState(false)

  useEffect(() => { stateRef.current = state }, [state])

  const scrollToBottom = useCallback(() => {
    setTimeout(() => chatScrollRef.current?.scrollToEnd?.({ animated: true }), 60)
  }, [])

  const addMsg = useCallback((role: ChatRole, text: string, meta?: ChatItem['meta']) => {
    const t = text.trim()
    if (!t) return
    setChat(prev => [...prev, { id: uid(), role, text: t, meta }])
    void rememberLocalTurn(role, t)
    scrollToBottom()
  }, [scrollToBottom])

  const appendStreaming = (kind: 'user' | 'model', chunk: string) => {
    if (kind === 'model') {
      modelBufRef.current += chunk
      const text = modelBufRef.current
      setChat(prev => {
        const last = prev[prev.length - 1]
        if (last?.id === 'model-streaming') return [...prev.slice(0, -1), { ...last, text }]
        return [...prev, { id: 'model-streaming', role: 'model', text }]
      })
    } else {
      // For user transcription: replace (Gemini sends the full accumulated transcript each time)
      userBufRef.current = chunk
      const text = chunk
      setChat(prev => {
        const last = prev[prev.length - 1]
        if (last?.id === 'user-streaming') return [...prev.slice(0, -1), { ...last, text }]
        return [...prev, { id: 'user-streaming', role: 'user', text }]
      })
    }
  }

  const finalizeStreaming = useCallback(() => {
    const modelText = modelBufRef.current.trim()
    const userText = userBufRef.current.trim()
    if (userText) void rememberLocalTurn('user', userText)
    if (modelText) void rememberLocalTurn('model', modelText)
    setChat(prev => prev.map(m =>
      m.id === 'model-streaming' ? { ...m, id: uid('model') } :
      m.id === 'user-streaming' ? { ...m, id: uid('user') } : m
    ))
    modelBufRef.current = ''
    userBufRef.current = ''
    scrollToBottom()
  }, [scrollToBottom])

  const injectWakeIntoGemini = useCallback((wake: WakeRecord) => {
    const text = String(wake.text || '').trim()
    if (!text || wsRef.current?.readyState !== WebSocket.OPEN) return false
    clearAudioQueue()
    wsRef.current.send(JSON.stringify({
      client_content: {
        turns: [{
          role: 'user',
          parts: [{ text: `System wake notification. Speak this to Boss naturally, then wait for a response if needed: ${wake.title ? `[${wake.title}] ` : ''}${text}` }],
        }],
        turn_complete: true,
      },
    }))
    setState('thinking')
    void ackWake(wake.id, isWeb)
    return true
  }, [isWeb])

  const handleExternalEvent = useCallback((event: AppEvent) => {
    if (event.type === 'hello') return

    if (event.type === 'wake') {
      const payload = event.payload && typeof event.payload === 'object' ? event.payload : undefined
      const wake = payload?.wake as WakeRecord | undefined
      const text = String(wake?.text || event.text || '').trim()
      if (!text) return
      const nextWake = wake || { id: String(payload?.wakeId || uid('wake')), title: event.title, text, priority: event.priority }
      addMsg('model', `[Wake] ${event.title ? `${event.title}: ` : ''}${text}`)
      if (!injectWakeIntoGemini(nextWake)) pendingWakeRef.current = nextWake
      return
    }

    if (event.type === 'dispatch_update') {
      const payload = event.payload && typeof event.payload === 'object' ? event.payload : undefined
      const dispatch = payload?.dispatch as Record<string, unknown> | undefined
      const metadata = dispatch?.metadata && typeof dispatch.metadata === 'object' ? dispatch.metadata as Record<string, unknown> : undefined
      const source = String(metadata?.source || '')
      const status = String(dispatch?.status || '')
      const text = String(event.text || '').trim()
      if (!text) return

      // Gemini tool calls already get the exact result through toolResponse and we render that as [M8].
      // Do not also render/inject the event stream copy, or the user sees Emma + M8 + Gemini duplicates.
      if (source === 'gemini-tool') return

      const agentId = String(dispatch?.agentId || '')
      const agentLabel = agentId === 'main' ? 'Emma' : agentId === 'builder' ? 'Builder' : agentId === 'video-ops' ? 'Video Ops' : 'Agent'
      const spoken = `[${agentLabel}] ${text}`
      const shouldInterrupt = status === 'blocked' || status === 'failed' || status === 'completed' || status === 'running'
      if (shouldInterrupt && wsRef.current?.readyState === WebSocket.OPEN) {
        clearAudioQueue()
        wsRef.current.send(JSON.stringify({
          client_content: {
            turns: [{
              role: 'user',
              parts: [{ text: `System update from background dispatch. Speak this update to the user naturally, then continue the conversation: ${spoken}` }],
            }],
            turn_complete: true,
          },
        }))
        setState('thinking')
      }
      return
    }

    if (event.type === 'openclaw_result' && event.text) {
      addMsg('model', `[OpenClaw] ${event.text}`)
      return
    }
    if (event.type !== 'notification') return

    const decision = decideNotificationHandling(event, { micOn: micOnRef.current, state: stateRef.current })
    if (decision === 'ignore') return

    const label = event.title?.trim() ? `[${event.title.trim()}] ` : '[Notification] '
    const text = `${label}${String(event.text || '').trim()}`.trim()
    if (!text) return

    addMsg('model', text)

    if (decision === 'interrupt') {
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning).catch(() => {})
      spokenNotificationQueueRef.current.push(text)
      console.warn('[spoken-notification] queued', { count: spokenNotificationQueueRef.current.length, text })
      processSpokenNotificationQueueRef.current()
    }
  }, [addMsg, injectWakeIntoGemini])

  const getAudioCtx = async () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new window.AudioContext()
      nextStartRef.current = audioCtxRef.current.currentTime
      // Create output analyser for orb audio reactivity
      const analyser = audioCtxRef.current.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.8
      analyser.connect(audioCtxRef.current.destination)
      outputAnalyserRef.current = analyser
    }
    if (audioCtxRef.current.state === 'suspended') await audioCtxRef.current.resume()
    return audioCtxRef.current
  }

  const playNativeChunk = useCallback(async (b64: string) => {
    const shouldResumeMic = micOnRef.current && !micPausedRef.current
    if (shouldResumeMic) micPausedRef.current = true
    try {
      if (!audioModeSetRef.current) {
        audioModeSetRef.current = true
        await setAudioModeAsync({
          allowsRecording: false,
          playsInSilentMode: true,
          shouldPlayInBackground: false,
          interruptionMode: 'doNotMix',
        })
      }

      const rawBytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
      const dataLen = rawBytes.length
      const sampleRate = playbackRateRef.current
      const channels = 1
      const bitsPerSample = 16
      const byteRate = sampleRate * channels * (bitsPerSample / 8)
      const blockAlign = channels * (bitsPerSample / 8)

      const header = new ArrayBuffer(44)
      const hv = new DataView(header)
      const wr = (off: number, s: string) => { for (let i = 0; i < s.length; i++) hv.setUint8(off + i, s.charCodeAt(i)) }
      wr(0, 'RIFF'); hv.setUint32(4, 36 + dataLen, true); wr(8, 'WAVE')
      wr(12, 'fmt '); hv.setUint32(16, 16, true); hv.setUint16(20, 1, true)
      hv.setUint16(22, channels, true); hv.setUint32(24, sampleRate, true)
      hv.setUint32(28, byteRate, true); hv.setUint16(32, blockAlign, true)
      hv.setUint16(34, bitsPerSample, true); wr(36, 'data'); hv.setUint32(40, dataLen, true)

      const wav = new Uint8Array(44 + dataLen)
      wav.set(new Uint8Array(header)); wav.set(rawBytes, 44)

      let bin = ''
      const chunkSize = 8192
      for (let i = 0; i < wav.length; i += chunkSize) {
        bin += String.fromCharCode(...wav.subarray(i, i + chunkSize))
      }
      const wavB64 = btoa(bin)

      const playSource = async (uri: string, cleanup?: () => void) => {
        await new Promise<void>((resolve, reject) => {
          const player = createAudioPlayer({ uri }, { updateInterval: 40 })
          let settled = false
          const finish = (error?: Error) => {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            subscription.remove()
            player.release()
            nativePlaybackCancelRef.current = null
            cleanup?.()
            error ? reject(error) : resolve()
          }
          const timeout = setTimeout(() => finish(new Error('Voice playback timed out')), pcmPlaybackDeadlineMs(dataLen, sampleRate))
          const subscription = player.addListener('playbackStatusUpdate', (status) => {
            if (status.didJustFinish) finish()
          })
          nativePlaybackCancelRef.current = () => finish()
          player.volume = 1
          player.play()
        })
      }
      try {
        await playSource(`data:audio/wav;base64,${wavB64}`)
      } catch {
        const filePath = FileSystem.cacheDirectory + `audio_${Date.now()}.wav`
        await FileSystem.writeAsStringAsync(filePath, wavB64, { encoding: FileSystem.EncodingType.Base64 })
        await playSource(filePath, () => { FileSystem.deleteAsync(filePath, { idempotent: true }).catch(() => {}) })
      }
    } catch (e) {
      console.warn('[playNativeChunk] error:', e)
    } finally {
      if (shouldResumeMic) micPausedRef.current = false
    }
  }, [])

  const drainAudioQueue = useCallback(async () => {
    if (audioPlayingRef.current) return
    audioPlayingRef.current = true
    while (audioQueueRef.current.length > 0) {
      // Drain all available chunks into one concatenated WAV for gapless playback
      const chunks = audioQueueRef.current.splice(0, audioQueueRef.current.length)
      const combined = concatPcmB64(chunks)
      await playNativeChunk(combined)
    }
    audioPlayingRef.current = false
    // If the turn ended while we were playing, check if there's leftover buffer
    if (nativePcmBufferRef.current.length > 0) {
      const remaining = nativePcmBufferRef.current.splice(0, nativePcmBufferRef.current.length)
      const combined = concatPcmB64(remaining)
      audioQueueRef.current.push(combined)
      nativePlaybackStartedRef.current = false
      drainAudioQueue()
    }
  }, [playNativeChunk])

  const enqueueNativeAudio = useCallback((b64: string) => {
    // Calculate audio level for native orb reactivity
    const rms = calcPcmRms(b64)
    if (rms > 0.01) setAudioLevel(rms)

    nativePcmBufferRef.current.push(b64)

    if (!nativePlaybackStartedRef.current) {
      if (nativePcmBufferRef.current.length >= NATIVE_BUFFER_THRESHOLD) {
        nativePlaybackStartedRef.current = true
        const buffered = nativePcmBufferRef.current.splice(0, nativePcmBufferRef.current.length)
        const combined = concatPcmB64(buffered)
        audioQueueRef.current.push(combined)
        drainAudioQueue()
      }
    } else if (nativePcmBufferRef.current.length >= NATIVE_BATCH_SIZE) {
      const batch = nativePcmBufferRef.current.splice(0, nativePcmBufferRef.current.length)
      const combined = concatPcmB64(batch)
      audioQueueRef.current.push(combined)
      drainAudioQueue()
    }
  }, [drainAudioQueue])

  const playAudio = useCallback(async (b64: string) => {
    if (speakerMutedRef.current) return
    if (isWeb) {
      const ticket = playbackDrainRef.current.begin()
      let source: AudioBufferSourceNode | null = null
      try {
        const ctx = await getAudioCtx()
        if (!ticket.current()) return
        const buf = pcm16ToAudioBuffer(ctx, b64, playbackRateRef.current)
        const src = ctx.createBufferSource()
        source = src
        src.buffer = buf
        src.connect(outputAnalyserRef.current || ctx.destination)
        webSourcesRef.current.add(src)
        src.onended = () => { webSourcesRef.current.delete(src); src.disconnect(); ticket.end() }
        const when = Math.max(ctx.currentTime, nextStartRef.current)
        src.start(when)
        nextStartRef.current = when + buf.duration
      } catch {
        if(source){webSourcesRef.current.delete(source);source.disconnect()}
        ticket.end()
      } finally {
        if (!ticket.current()) ticket.end()
      }
    } else {
      enqueueNativeAudio(b64)
    }
  }, [isWeb, enqueueNativeAudio])

  // Clear audio queue on interruption
  const clearAudioQueue = () => {
    playbackDrainRef.current.clear()
    for (const source of webSourcesRef.current) { source.onended = null; try { source.stop() } catch {} source.disconnect() }
    webSourcesRef.current.clear()
    nativePlaybackCancelRef.current?.()
    if (audioCtxRef.current) {
      nextStartRef.current = audioCtxRef.current.currentTime
    }
    // Clear native queue and buffer
    audioQueueRef.current = []
    nativePcmBufferRef.current = []
    nativePlaybackStartedRef.current = false
  }

  // (startMic / stopMic defined above as unified platform-aware wrappers)

  // ─── Native camera (Android/iOS) ───
  const stopCameraNative = useCallback(() => {
    if (frameIntervalRef.current) { clearInterval(frameIntervalRef.current); frameIntervalRef.current = null }
    videoModeRef.current = 'none'
    setVideoMode('none')
    setShowPreview(false)
  }, [])

  const startCameraNative = useCallback(async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    if (!cameraPermission?.granted) {
      const result = await requestCameraPermission()
      if (!result.granted) { setError('Camera permission denied.'); return }
    }
    setShowPreview(true)
    videoModeRef.current = 'camera'
    setVideoMode('camera')
    frameIntervalRef.current = setInterval(async () => {
      if (!nativeCameraRef.current || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
      try {
        const photo = await nativeCameraRef.current.takePictureAsync({
          base64: true, quality: 0.4, skipProcessing: true,
          shutterSound: false,
          // @ts-ignore - expo-camera prop to suppress screen flash on Android
          animateShutter: false,
        })
        if (!photo?.base64) return
        wsRef.current.send(JSON.stringify({
          realtimeInput: { video: { data: photo.base64, mimeType: 'image/jpeg' } },
        }))
      } catch {}
    }, 1000)
  }, [cameraPermission, requestCameraPermission])

  const stopVideo = useCallback(() => {
    if (!isWeb) { stopCameraNative(); return }
    if (frameIntervalRef.current) { clearInterval(frameIntervalRef.current); frameIntervalRef.current = null }
    videoStreamRef.current?.getTracks().forEach(t => t.stop())
    videoStreamRef.current = null
    if (videoElRef.current) {
      videoElRef.current.srcObject = null
      try { document.body.removeChild(videoElRef.current) } catch {}
      videoElRef.current = null
    }
    if (videoCanvasRef.current) {
      try { document.body.removeChild(videoCanvasRef.current) } catch {}
      videoCanvasRef.current = null
    }
    videoModeRef.current = 'none'
    setVideoMode('none')
    setShowPreview(false)
  }, [isWeb, stopCameraNative])

  const startVideo = useCallback(async (mode: 'camera' | 'screen') => {
    if (!isWeb) {
      if (mode === 'camera') await startCameraNative()
      else setError('Screen share not available on Android.')
      return
    }
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      setError('Conecta primero antes de activar video.')
      return
    }
    try {
      stopVideo()

      // Start mic first, synchronously within the user gesture context
      if (!micOnRef.current) {
        await startMic()
      }

      // Check API availability
      if (mode === 'screen' && !navigator.mediaDevices?.getDisplayMedia) {
        setError('Screen share no disponible en este browser/dispositivo.')
        return
      }
      if (mode === 'camera' && !navigator.mediaDevices?.getUserMedia) {
        setError('Cámara no disponible en este browser/dispositivo.')
        return
      }

      let stream: MediaStream
      if (mode === 'camera') {
        // Try ideal constraints, fall back to bare minimum
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: { ideal: 'environment' } }, audio: false })
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        }
      } else {
        // @ts-ignore
        stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 1 }, audio: false })
      }
      videoStreamRef.current = stream

      // Hidden video element
      const el = document.createElement('video')
      el.autoplay = true; el.muted = true; el.playsInline = true
      el.setAttribute('playsinline', '')
      el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px'
      document.body.appendChild(el)
      videoElRef.current = el
      el.srcObject = stream

      // Offscreen canvas
      const cv = document.createElement('canvas')
      cv.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px'
      document.body.appendChild(cv)
      videoCanvasRef.current = cv

      // Try to play - don't await, just fire
      el.play().catch(() => {})

      // Start capturing - interval handles readyState check internally
      frameIntervalRef.current = setInterval(() => {
        const ws = wsRef.current
        if (!ws || ws.readyState !== WebSocket.OPEN) return
        const video = videoElRef.current
        const canvas = videoCanvasRef.current
        if (!video || !canvas) return
        // readyState 2=HAVE_CURRENT_DATA, 3=HAVE_FUTURE_DATA, 4=HAVE_ENOUGH_DATA
        if (video.videoWidth === 0 || video.readyState < 2) return
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        const ctx2d = canvas.getContext('2d')
        if (!ctx2d) return
        try {
          ctx2d.drawImage(video, 0, 0)
          const b64 = canvasToB64(canvas, 0.6)
          ws.send(JSON.stringify({
            realtimeInput: { video: { data: b64, mimeType: 'image/jpeg' } },
          }))
        } catch {}
      }, 1000)

      // Handle stream ending (user stops screen share natively)
      stream.getVideoTracks()[0]?.addEventListener('ended', () => stopVideo())

      videoModeRef.current = mode
      setVideoMode(mode)
      if (mode === 'camera') setShowPreview(true)
    } catch (e) {
      const msg = (e as Error).message || String(e)
      if (msg.includes('Permission') || msg.includes('NotAllowed')) {
        setError('Permiso denegado para ' + (mode === 'camera' ? 'cámara' : 'pantalla') + '.')
      } else if (msg.includes('NotFound') || msg.includes('DevicesNotFound')) {
        setError('No se encontró ' + (mode === 'camera' ? 'cámara' : 'pantalla') + '.')
      } else if (msg.includes('NotSupported') || msg.includes('TypeError')) {
        setError(mode === 'screen' ? 'Screen share no soportado en este dispositivo.' : 'Cámara no soportada.')
      } else {
        setError((mode === 'camera' ? 'Cam' : 'Screen') + ': ' + msg)
      }
      stopVideo()
    }
  }, [isWeb, stopVideo])

  const attachFile = useCallback(async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    if (isWeb) {
      if (!fileInputRef.current) {
        const input = document.createElement('input')
        input.type = 'file'
        input.accept = 'image/*,application/pdf,text/*,.txt,.md,.json,.csv'
        input.style.display = 'none'
        document.body.appendChild(input)
        fileInputRef.current = input
      }
      fileInputRef.current.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0]
        if (!file) return
        const reader = new FileReader()
        reader.onload = () => {
          const result = reader.result as string
          const b64 = result.split(',')[1]
          const mimeType = file.type || 'application/octet-stream'
          wsRef.current?.send(JSON.stringify({
            client_content: {
              turns: [{ role: 'user', parts: [
                { text: `Archivo adjunto: ${file.name}` },
                { inline_data: { mime_type: mimeType, data: b64 } },
              ]}],
              turn_complete: true,
            },
          }))
          addMsg('user', `[Archivo: ${file.name}]`)
        }
        reader.readAsDataURL(file)
        if (fileInputRef.current) fileInputRef.current.value = ''
      }
      fileInputRef.current.click()
      return
    }
    // Native: use expo-document-picker
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: ['image/*', 'application/pdf', 'text/*'],
        copyToCacheDirectory: true,
      })
      if (result.canceled || !result.assets?.[0]) return
      const asset = result.assets[0]
      const b64 = await FileSystem.readAsStringAsync(asset.uri, { encoding: FileSystem.EncodingType.Base64 })
      const mimeType = asset.mimeType || 'application/octet-stream'
      wsRef.current?.send(JSON.stringify({
        client_content: {
          turns: [{
            role: 'user',
            parts: [
              { text: `Archivo adjunto: ${asset.name}` },
              { inline_data: { mime_type: mimeType, data: b64 } },
            ],
          }],
          turn_complete: true,
        },
      }))
      addMsg('user', `[Archivo: ${asset.name}]`)
    } catch (e) {
      console.warn('[attachFile]', e)
    }
  }, [isWeb, addMsg])

  const handleToolCall = useCallback(async (tc: { functionCalls?: Array<{ id?: string; name?: string; args?: Record<string, unknown> }> }) => {
    setState('searching')
    if (isWeb) {
      try {
        const ctx = await getAudioCtx()
        const osc = ctx.createOscillator()
        osc.type = 'sine'
        osc.frequency.setValueAtTime(800, ctx.currentTime)
        osc.frequency.exponentialRampToValueAtTime(300, ctx.currentTime + 0.1)
        const gain = ctx.createGain()
        gain.gain.setValueAtTime(0.1, ctx.currentTime)
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1)
        osc.connect(gain)
        gain.connect(ctx.destination)
        osc.start()
        osc.stop(ctx.currentTime + 0.1)
      } catch {}
    } else {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {})
    }

    const responses: Array<Record<string, unknown>> = []
    for (const call of tc?.functionCalls || []) {
      console.log('[m8live] toolCall args', { name: call.name, args: call.args || {} })
      addMsg('user', `[Tool: ${call.name}] ${JSON.stringify(call.args || {})}`)
      try {
        const args = (call.args || {}) as Record<string, unknown>
        const json = isLocalDeviceTool(call.name)
          ? await invokeLocalDeviceTool(call.name!, args, {
              cameraGranted: !!cameraPermission?.granted,
              micOn: micOnRef.current,
              openCamera: async () => { await startVideoActionRef.current('camera') },
              stopCamera: () => { stopVideoActionRef.current() },
              toggleMic: async () => {
                if (micOnRef.current) await stopMicActionRef.current()
                else await startMicActionRef.current()
              },
            })
          : isOpenClawTool(call.name)
            ? await invokeOpenClawTool(call.name!, args, isWeb)
            : isMemoryTool(call.name)
              ? await invokeMemoryTool(call.name!, args, isWeb)
              : isMessageTool(call.name)
                ? await invokeMessageTool(call.name!, args, isWeb)
                : { ok: false, error: `Unsupported tool: ${call.name}` }

        responses.push({ id: call.id, name: call.name, response: json })
        if (json?.response) addMsg('model', `[M8] ${String(json.response)}`)
        else if (json?.message) addMsg('model', `[Device] ${String(json.message)}`)
        else if (json?.error) addMsg('model', `[Error] ${String(json.error)}`)
      } catch (e) {
        const err = String((e as Error).message)
        responses.push({ id: call.id, name: call.name, response: { ok: false, error: err } })
      }
    }
    wsRef.current?.send(JSON.stringify({ toolResponse: { functionResponses: responses } }))
    setState('thinking')
  }, [addMsg, cameraPermission?.granted, isWeb])

  // ─── Native mic (Android/iOS) ───
  const startMicNative = useCallback(async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    try {
      await startNativeRecording({
        sampleRate: 16000,
        channels: 1,
        encoding: 'pcm_16bit',
        interval: 100,
        onAudioStream: async (event: AudioDataEvent) => {
          if (!micOnRef.current || micPausedRef.current) return
          const data = event.data
          if (typeof data !== 'string') return // web path returns Float32Array, skip
          wsRef.current?.send(JSON.stringify({
            realtimeInput: { audio: { data, mimeType: 'audio/pcm;rate=16000' } },
          }))
          // Estimate RMS from chunk size as proxy for mic level (no analyser available)
          setMicLevel(Math.min(1, (event.eventDataSize / 3200) * 0.8))
        },
      })
      micOnRef.current = true
      setMicOn(true)
      setState('listening')
    } catch (e) {
      setError('Mic: ' + String((e as Error).message || e))
    }
  }, [startNativeRecording])

  const stopMicNative = useCallback(async () => {
    try { await stopNativeRecording() } catch {}
    if (micOnRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }))
    }
    micOnRef.current = false
    setMicOn(false)
    setMicLevel(0)
  }, [stopNativeRecording])

  // ─── Native camera (Android/iOS) ───
  // ─── Unified mic/camera/video wrappers (platform-aware) ───
  const startMic = useCallback(async () => {
    if (isWeb) {
      // web path defined below
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
      if (webMicPendingRef.current) return
      webMicPendingRef.current = true
      const requestedSocket = wsRef.current
      let acquiredStream: MediaStream | null = null
      let acquiredSource: MediaStreamAudioSourceNode | null = null
      let acquiredProcessor: ScriptProcessorNode | null = null
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 } })
        acquiredStream = stream
        if (wsRef.current !== requestedSocket || requestedSocket.readyState !== WebSocket.OPEN) { stream.getTracks().forEach(track => track.stop()); return }
        micStreamRef.current = stream
        const ctx = await getAudioCtx()
        if (wsRef.current !== requestedSocket || requestedSocket.readyState !== WebSocket.OPEN || micStreamRef.current !== stream) { stream.getTracks().forEach(track => track.stop()); return }
        const source = ctx.createMediaStreamSource(stream)
        acquiredSource = source
        const proc = ctx.createScriptProcessor(4096, 1, 1)
        acquiredProcessor = proc
        proc.onaudioprocess = e => {
          if (!micOnRef.current || micPausedRef.current) return
          const input = e.inputBuffer.getChannelData(0)
          const pcm = downsample(input, ctx.sampleRate, 16000)
          wsRef.current?.send(JSON.stringify({
            realtimeInput: { audio: { data: pcm16ToB64(pcm), mimeType: 'audio/pcm;rate=16000' } },
          }))
        }
        source.connect(proc)
        proc.connect(ctx.destination)
        audioSrcRef.current = source; audioProcRef.current = proc
        micOnRef.current = true
        setMicOn(true)
        setState('listening')
      } catch (e) {
        try { acquiredProcessor?.disconnect() } catch {}
        try { acquiredSource?.disconnect() } catch {}
        acquiredStream?.getTracks().forEach(track => track.stop())
        if (micStreamRef.current === acquiredStream) micStreamRef.current = null
        micOnRef.current = false
        setMicOn(false)
        setMicLevel(0)
        setError('Microphone access could not open. Check its permission and try again.')
      } finally { webMicPendingRef.current = false }
    } else {
      await startMicNative()
    }
  }, [isWeb, startMicNative])

  const stopMic = useCallback(async () => {
    if (isWeb) {
      if (micOnRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }))
      }
      try { audioProcRef.current?.disconnect() } catch {}
      try { audioSrcRef.current?.disconnect() } catch {}
      micStreamRef.current?.getTracks().forEach(t => t.stop())
      audioProcRef.current = null; audioSrcRef.current = null; micStreamRef.current = null
      micOnRef.current = false; micPausedRef.current = false
      setMicOn(false)
      setMicLevel(0)
    } else {
      await stopMicNative()
    }
  }, [isWeb, stopMicNative])

  const connect = useCallback(async () => {
    if (wsRef.current && (wsRef.current.readyState === WebSocket.OPEN || wsRef.current.readyState === WebSocket.CONNECTING)) return
    try {
      setError('')
      setState('connecting')
      let wsUrl: string
      if (isWeb) {
        const proxyBase = getProxyBase(true)
        const targetBase = proxyBase || window.location.origin
        wsUrl = appendBridgeToken(toWebSocketUrl(targetBase, hostedWorkspace ? '/engine/live' : '/gemini'))
      } else {
        const proxyBase = getProxyBase(false)
        wsUrl = appendBridgeToken(toWebSocketUrl(proxyBase, '/gemini'))
      }
      intentionalDisconnectRef.current = false
      const ws = new WebSocket(wsUrl)
      wsRef.current = ws

      ws.onopen = async () => {
        if (ws !== wsRef.current) return
        const [remoteMemory, localMemory] = await Promise.all([hostedWorkspace ? Promise.resolve(null) : fetchMemoryContext(isWeb), getLocalMemory()])
        if (ws !== wsRef.current) return
        const memoryContext = [
          remoteMemory?.summary ? `Durable memory:\n${remoteMemory.summary}` : '',
          formatLocalMemory(localMemory) ? `Recent local conversation:\n${formatLocalMemory(localMemory)}` : '',
        ].filter(Boolean).join('\n\n')
        memoryContextRef.current = memoryContext
        const systemText = memoryContext ? `${SYSTEM_INSTRUCTION}\n\nCURRENT MEMORY CONTEXT:\n${memoryContext}` : SYSTEM_INSTRUCTION
        ws.send(JSON.stringify({
          setup: {
            model: `models/${GEMINI_LIVE_MODEL}`,
            generation_config: {
              response_modalities: ['AUDIO'],
              speech_config: { voice_config: { prebuilt_voice_config: { voice_name: settings.voiceId || 'Zephyr' } } },
            },
            // Tune VAD to reduce false positives from noise
            realtime_input_config: {
              automatic_activity_detection: {
                disabled: false,
                start_of_speech_sensitivity: 'START_SENSITIVITY_HIGH',
                end_of_speech_sensitivity: 'END_SENSITIVITY_HIGH',
                silence_duration_ms: 650,
                prefix_padding_ms: 180,
              },
            },
            // Context window compression to avoid overflows
            context_window_compression: {
              trigger_tokens: 80000,
              sliding_window: { target_tokens: 40000 },
            },
            system_instruction: { parts: [{ text: systemText }] },
            input_audio_transcription: {},
            output_audio_transcription: {},
            tools: [...BUILTIN_GEMINI_TOOLS, { function_declarations: TOOL_DECLARATIONS }],
          },
        }))
      }

      ws.onmessage = async event => {
        if (ws !== wsRef.current) return
        let msg: Record<string, unknown>
        try { msg = JSON.parse(event.data) } catch { return }

        if (msg.error) {
          clearAudioQueue()
          nativePcmBufferRef.current = []
          nativePlaybackStartedRef.current = false
          micPausedRef.current = false
          finalizeStreaming()
          setAudioLevel(0)
          setError('The voice service could not finish. Try again, or start a new conversation.')
          setState(micOnRef.current ? 'listening' : 'ready')
          return
        }

        if (msg.goAway) {
          stopMic(); stopVideo()
          setState('idle')
          setError('Live session expired. Tap when you want to wake M8 Live again.')
          try { ws.close(1000, 'goAway acknowledged') } catch {}
          return
        }

        if (msg.setupComplete !== undefined) {
          const setup = msg.setupComplete as {
            provider?: string
            sampleRate?: number
            capabilities?: { vision?: boolean }
          }
          setSupportsVision(setup.provider !== 'spark' || setup.capabilities?.vision === true)
          if ([16000, 22050, 24000, 44100, 48000].includes(Number(setup.sampleRate)))
            playbackRateRef.current = Number(setup.sampleRate)
          setState('ready')
          const pendingWake = pendingWakeRef.current
          if (pendingWake && injectWakeIntoGemini(pendingWake)) pendingWakeRef.current = null
          return
        }

        // Auto function calling
        if (msg.toolCall) {
          await handleToolCall(msg.toolCall as Parameters<typeof handleToolCall>[0])
          return
        }

        const sc = msg.serverContent as Record<string, unknown> | undefined
        if (!sc) return

        // Interruption - clear audio queue
        if (sc.interrupted) {
          clearAudioQueue()
          nativePcmBufferRef.current = []
          nativePlaybackStartedRef.current = false
          micPausedRef.current = false
          setAudioLevel(0)
          setState(micOnRef.current ? 'listening' : 'ready')
          return
        }

        // User speech transcription (Gemini sends full accumulated text each time)
        const inT = (sc.inputTranscription as Record<string, string> | undefined)?.text
        if (inT?.trim()) appendStreaming('user', inT.trim())

        // Model speech transcription
        const outT = (sc.outputTranscription as Record<string, string> | undefined)?.text
        if (outT) appendStreaming('model', outT)

        // Audio chunks - collect all PCM parts and enqueue as one chunk
        const parts = (sc.modelTurn as Record<string, unknown> | undefined)?.parts as Array<Record<string, unknown>> | undefined
        if (parts) {
          setState('responding')
          const pcmParts: string[] = []
          for (const part of parts) {
            const id = part.inlineData as Record<string, string> | undefined
            if (id?.data && String(id.mimeType || '').startsWith('audio/pcm')) {
              const rate = Number(String(id.mimeType).match(/rate=(\d+)/)?.[1] || playbackRateRef.current)
              if ([16000, 22050, 24000, 44100, 48000].includes(rate)) playbackRateRef.current = rate
              pcmParts.push(id.data)
            }
          }
          if (pcmParts.length > 0) {
            for (const b64 of pcmParts) void playAudio(b64)
          }
        }

        if (sc.turnComplete) {
          // Flush any remaining native audio buffer
          if (!isWeb && nativePcmBufferRef.current.length > 0) {
            const remaining = nativePcmBufferRef.current.splice(0, nativePcmBufferRef.current.length)
            const combined = concatPcmB64(remaining)
            audioQueueRef.current.push(combined)
            drainAudioQueue()
          }
          nativePlaybackStartedRef.current = false
          finalizeStreaming()
          const finish = () => {
            micPausedRef.current = false
            setAudioLevel(0)
            setState(micOnRef.current ? 'listening' : 'ready')
          }
          if (isWeb) playbackDrainRef.current.complete(finish)
          else finish()
        }
      }

      ws.onerror = () => { if(ws !== wsRef.current)return; clearAudioQueue(); setError('Connection failed.'); setState('error') }
      ws.onclose = e => {
        if (ws !== wsRef.current) return
        clearAudioQueue()
        const wasIntentional = intentionalDisconnectRef.current
        console.warn('[m8live] gemini websocket closed', { code: e.code, reason: e.reason || '', wasIntentional })
        stopMic(); stopVideo()
        setState('idle')
        if (hostedWorkspace && !wasIntentional) {
          void getBridgeSessionStatus(true).then(status => setBridgeAuthenticated(status.authenticated)).catch(() => {})
        }
        const rawReason = typeof e.reason === 'string' ? e.reason.trim() : ''
        const goAwayReason = /goaway|go away|session expired|session duration/i.test(rawReason)
        const reason = rawReason || (e.code === 1008 ? 'Modelo/configuración incompatible en el backend.' : '')
        if (goAwayReason) {
          setError('Live session expired. Tap when you want to wake M8 Live again.')
        } else if (e.code !== 1000 && e.code !== 1005) {
          setError(hostedWorkspace ? 'Voice could not connect. Check your access and try again later.' : reason ? `Disconnected (${e.code}): ${reason}` : `Disconnected (${e.code})`)
          if (!hostedWorkspace && !wasIntentional && e.code === 1006) {
            if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
            reconnectTimerRef.current = setTimeout(() => {
              reconnectTimerRef.current = null
              connect()
            }, 1200)
          }
        }
      }
    } catch (e) {
      setError(String((e as Error).message || e))
      setState('error')
    }
  }, [bridgeAuthenticated, isWeb, handleToolCall, playAudio, finalizeStreaming, stopMic, stopVideo, settings.voiceId, drainAudioQueue, injectWakeIntoGemini])

  const processSpokenNotificationQueue = useCallback(async () => {
    if (spokenNotificationBusyRef.current) return
    const next = spokenNotificationQueueRef.current[0]
    if (!next) return
    console.warn('[spoken-notification] processing', { state: stateRef.current, wsState: wsRef.current?.readyState, queue: spokenNotificationQueueRef.current.length })

    if (spokenNotificationRetryRef.current) {
      clearTimeout(spokenNotificationRetryRef.current)
      spokenNotificationRetryRef.current = null
    }

    const retrySoon = (delay = 1500) => {
      if (spokenNotificationRetryRef.current) clearTimeout(spokenNotificationRetryRef.current)
      spokenNotificationRetryRef.current = setTimeout(() => {
        spokenNotificationRetryRef.current = null
        processSpokenNotificationQueueRef.current()
      }, delay)
    }

    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
      void connect().catch((error) => console.warn('[spoken-notification] reconnect failed', String(error?.message || error)))
      retrySoon(2200)
      return
    }

    spokenNotificationBusyRef.current = true
    try {
      // Avoid the Android/emulator failure path: mic capture + Gemini audio playback + event injection at once.
      if (micOnRef.current) await stopMic()
      clearAudioQueue()
      await new Promise(resolve => setTimeout(resolve, 250))
      console.warn('[spoken-notification] sending to gemini')
      wsRef.current.send(JSON.stringify({
        realtimeInput: { text: `System notification. Read this out loud to Boss now, then stop and wait: ${next}` },
      }))
      spokenNotificationQueueRef.current.shift()
      console.warn('[spoken-notification] sent')
      setState('thinking')
    } catch (error) {
      console.warn('[spoken-notification] send failed', String((error as Error)?.message || error))
      retrySoon(2200)
    } finally {
      spokenNotificationBusyRef.current = false
      if (spokenNotificationQueueRef.current.length > 0) retrySoon(8000)
    }
  }, [connect, stopMic])

  useEffect(() => { processSpokenNotificationQueueRef.current = processSpokenNotificationQueue }, [processSpokenNotificationQueue])
  useEffect(() => { startMicActionRef.current = startMic }, [startMic])
  useEffect(() => { stopMicActionRef.current = stopMic }, [stopMic])
  useEffect(() => { startVideoActionRef.current = startVideo }, [startVideo])
  useEffect(() => { stopVideoActionRef.current = stopVideo }, [stopVideo])

  const disconnect = useCallback(() => {
    clearAudioQueue()
    intentionalDisconnectRef.current = true
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    stopMic(); stopVideo()
    wsRef.current?.close()
    wsRef.current = null
    setState('idle')
  }, [stopMic, stopVideo])

  useEffect(() => {
    const rawWakeId = Array.isArray(params.wakeId) ? params.wakeId[0] : params.wakeId
    const wakeId = String(rawWakeId || '').trim()
    if (!wakeId || processedWakeIdRef.current === wakeId) return
    if (isWeb && (!bridgeAuthenticated || bridgeChecking)) return
    processedWakeIdRef.current = wakeId
    ;(async () => {
      try {
        const wake = await fetchWake(wakeId, isWeb)
        pendingWakeRef.current = wake
        addMsg('model', `[Wake] ${wake.title ? `${wake.title}: ` : ''}${wake.text}`)
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          if (injectWakeIntoGemini(wake)) pendingWakeRef.current = null
        } else {
          await connect()
        }
      } catch (error) {
        setError(String((error as Error).message || error))
      }
    })()
  }, [params.wakeId, isWeb, bridgeAuthenticated, bridgeChecking, addMsg, connect, injectWakeIntoGemini])

  const sendText = async () => {
    const text = draft.trim()
    if (hostedWorkspace && text.length > 4000) { setError('Keep your message within 4,000 characters. Your draft is still here to edit.'); return }
    if (!text || !isConnected) return
    clearAudioQueue()
    setDraft('')
    addMsg('user', text)
    setState('thinking')
    try {
      wsRef.current?.send(JSON.stringify({
        client_content: {
          turns: [{
            role: 'user',
            parts: [{ text }],
          }],
          turn_complete: true,
        },
      }))
    } catch (e) {
      const message = String((e as Error).message || e)
      addMsg('model', `[Error] ${message}`)
      setError(message)
      setState('error')
    }
  }

  const refreshBridgeStatus = useCallback(async () => {
    const status = await getBridgeSessionStatus(true)
    setBridgeAuthenticated(Boolean(status.authenticated))
    setPasskeySupported(Boolean(status.passkeySupported ?? isPasskeySupported()))
    setPasskeyConfigured(Boolean(status.passkeyConfigured))
    setPasswordConfigured(Boolean(status.passwordConfigured))
    setRegistrationOpen(status.registrationOpen === true)
    return status
  }, [])

  const unlockBridge = useCallback(async () => {
    const password = bridgePassword.trim()
    if (!password) {
      setBridgeAuthError('Password required.')
      return
    }
    setBridgeAuthBusy(true)
    setBridgeAuthError('')
    try {
      const status = await createBridgeSession(password)
      console.log('[m8live] bridge unlocked', status)
      setBridgeAuthenticated(true)
      setPasskeySupported(Boolean(status.passkeySupported ?? isPasskeySupported()))
      setPasskeyConfigured(Boolean(status.passkeyConfigured))
    setPasswordConfigured(Boolean(status.passwordConfigured))
    setRegistrationOpen(status.registrationOpen === true)
      setBridgePassword('')
      setError('')
    } catch (e) {
      setBridgeAuthenticated(false)
      setBridgeAuthError(String((e as Error).message || e))
    } finally {
      setBridgeAuthBusy(false)
    }
  }, [bridgePassword])

  const unlockWithPasskey = useCallback(async () => {
    setPasskeyBusy(true)
    setBridgeAuthError('')
    try {
      await authenticateBridgePasskey()
      await refreshBridgeStatus()
      setError('')
    } catch (e) {
      setBridgeAuthenticated(false)
      setBridgeAuthError(String((e as Error).message || e))
    } finally {
      setPasskeyBusy(false)
    }
  }, [refreshBridgeStatus])

  const enablePasskey = useCallback(async () => {
    setPasskeyBusy(true)
    setBridgeAuthError('')
    try {
      await registerBridgePasskey(hostedWorkspace ? workspaceInvite.trim() : '')
      if (hostedWorkspace) { setWorkspaceInvite(''); await refreshBridgeStatus() }
      setPasskeyConfigured(true)
    } catch (e) {
      setBridgeAuthError(String((e as Error).message || e))
    } finally {
      setPasskeyBusy(false)
    }
  }, [workspaceInvite, refreshBridgeStatus])

  useEffect(() => {
    let mounted = true
    if (!isWeb) {
      setBridgeAuthenticated(true)
      setBridgeChecking(false)
      return
    }
    setBridgeChecking(true)
    getBridgeSessionStatus(true)
      .then((status) => {
        console.log('[m8live] bridge session status', status)
        if (!mounted) return
        setBridgeAuthenticated(Boolean(status.authenticated))
        setPasskeySupported(Boolean(status.passkeySupported ?? isPasskeySupported()))
        setPasskeyConfigured(Boolean(status.passkeyConfigured))
    setPasswordConfigured(Boolean(status.passwordConfigured))
    setRegistrationOpen(status.registrationOpen === true)
      })
      .catch((e) => {
        if (!mounted) return
        setBridgeAuthenticated(false)
        setPasskeySupported(isPasskeySupported())
        setBridgeAuthError(String((e as Error).message || e))
      })
      .finally(() => {
        if (mounted) setBridgeChecking(false)
      })
    return () => { mounted = false }
  }, [isWeb])

  useEffect(() => {
    if (isWeb && (!bridgeAuthenticated || bridgeChecking)) return
    // Hosted sessions have finite public capacity. Start only from the existing mic control.
    if (!hostedWorkspace) connect()
    return () => { disconnect() }
  }, [bridgeAuthenticated, bridgeChecking, connect, disconnect, isWeb])

  useEffect(() => {
    eventStreamCleanupRef.current?.()
    if (isWeb && (!bridgeAuthenticated || bridgeChecking)) {
      eventStreamCleanupRef.current = null
      return
    }
    eventStreamCleanupRef.current = connectAppEventStream({
      isWeb,
      onEvent: handleExternalEvent,
      onError: (streamError) => console.warn('[events]', streamError.message),
    })
    return () => {
      eventStreamCleanupRef.current?.()
      eventStreamCleanupRef.current = null
    }
  }, [bridgeAuthenticated, bridgeChecking, handleExternalEvent, isWeb])

  // ─── Mic level visualization via AnalyserNode ───
  useEffect(() => {
    if (!isWeb || !micOn || !micStreamRef.current) {
      if (micAnimRef.current) cancelAnimationFrame(micAnimRef.current)
      setMicLevel(0)
      return
    }
    let mounted = true
    const ctx = audioCtxRef.current
    if (!ctx) return
    let analyser: AnalyserNode
    let source: MediaStreamAudioSourceNode
    try {
      analyser = ctx.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.8
      source = ctx.createMediaStreamSource(micStreamRef.current)
      source.connect(analyser)
    } catch { return }
    const dataArray = new Uint8Array(analyser.frequencyBinCount)
    const tick = () => {
      if (!mounted) return
      micAnimRef.current = requestAnimationFrame(tick)
      analyser.getByteFrequencyData(dataArray)
      let sum = 0
      for (let i = 0; i < dataArray.length; i++) sum += dataArray[i]
      setMicLevel(sum / dataArray.length / 255)
    }
    tick()
    return () => {
      mounted = false
      if (micAnimRef.current) cancelAnimationFrame(micAnimRef.current)
      try { source.disconnect() } catch {}
      setMicLevel(0)
    }
  }, [isWeb, micOn])

  // ─── Output audio level via AnalyserNode (web) ───
  const outputAnimRef = useRef<number>(0)
  useEffect(() => {
    if (!isWeb) return
    const analyser = outputAnalyserRef.current
    if (!analyser) return
    let mounted = true
    const data = new Float32Array(analyser.fftSize)
    const tick = () => {
      if (!mounted) return
      outputAnimRef.current = requestAnimationFrame(tick)
      analyser.getFloatTimeDomainData(data)
      let sumSq = 0
      for (let i = 0; i < data.length; i++) sumSq += data[i] * data[i]
      const rms = Math.min(1, Math.sqrt(sumSq / data.length) * 3.5)
      setAudioLevel(rms > 0.01 ? rms : 0)
    }
    tick()
    return () => {
      mounted = false
      if (outputAnimRef.current) cancelAnimationFrame(outputAnimRef.current)
    }
  }, [isWeb, state])

  const isConnected = state === 'ready' || state === 'listening' || state === 'responding'

  const stateColor = {
    ready: '#ffffff',
    listening: '#00fc97',
    responding: '#00ffff',
    thinking: '#8B5CF6',
    searching: '#F59E0B',
    connecting: '#F97316',
    error: '#ef4444',
    idle: '#ababab',
  }[state]

  const stateLabel = {
    ready: 'READY',
    listening: 'LISTENING',
    responding: 'SPEAKING',
    thinking: 'THINKING',
    searching: 'SEARCHING',
    connecting: 'CONNECTING...',
    error: 'ERROR',
    idle: 'OFFLINE',
  }[state]

  // Last model transcript for status area
  const lastModelText = (() => {
    for (let i = chat.length - 1; i >= 0; i--) {
      if (chat[i].role === 'model' && chat[i].text.trim()) return chat[i].text.trim()
    }
    return ''
  })()

  const showLiveBadge = state === 'ready' || state === 'listening' || state === 'responding' || state === 'thinking' || state === 'searching'

  return (
    <View style={[s.root, { paddingTop: insets.top }]} >
      {!!error && (
        <Pressable style={s.errorBar} onPress={() => { setError(''); connect() }}>
          <Text style={s.errorText}>{error} -- tap to retry</Text>
        </Pressable>
      )}

      {isWeb && (!bridgeAuthenticated || bridgeChecking) && (
        <View style={s.authOverlay}>
          <View style={s.authCard}>
            <Text style={s.authTitle}>
              {passkeyConfigured || passwordConfigured ? 'Sign in to voice' : 'Voice access is not ready'}
            </Text>
            <Text style={s.authCopy}>
              {passkeyConfigured
                ? 'Use your passkey to continue.'
                : passwordConfigured
                  ? 'Sign in, then add a passkey for future access.'
                  : 'Ask your administrator to finish access setup, then check again.'}
            </Text>
            {passkeySupported && passkeyConfigured && (
              <Pressable
                accessibilityRole="button"
                style={[s.authButton, (bridgeChecking || passkeyBusy) && { opacity: 0.6 }]}
                onPress={() => {
                  if (!bridgeChecking && !passkeyBusy) void unlockWithPasskey()
                }}
                disabled={bridgeChecking || passkeyBusy}
              >
                <Text style={s.authButtonText}>
                  {bridgeChecking
                    ? 'Checking...'
                    : passkeyBusy
                      ? 'Waiting for biometric...'
                      : hostedWorkspace ? 'Sign in with a passkey' : 'Use fingerprint or PIN'}
                </Text>
              </Pressable>
            )}
            {hostedWorkspace && registrationOpen && (
              <>
                <TextInput accessibilityLabel="Invitation code" value={workspaceInvite} onChangeText={setWorkspaceInvite}
                  placeholder="Invitation code" placeholderTextColor="rgba(255,255,255,0.28)" secureTextEntry
                  maxLength={43} autoCapitalize="none" autoCorrect={false} style={s.authInput} editable={!passkeyBusy} />
                <Pressable accessibilityRole="button" style={s.authButtonSecondary} disabled={passkeyBusy || bridgeChecking || workspaceInvite.trim().length !== 43}
                  onPress={() => void enablePasskey()}><Text style={s.authButtonSecondaryText}>Create access with a passkey</Text></Pressable>
              </>
            )}
            {passwordConfigured && (
              <>
                {' '}
                <TextInput
                  value={bridgePassword}
                  onChangeText={(value) => {
                    setBridgePassword(value)
                    if (bridgeAuthError) setBridgeAuthError('')
                  }}
                  placeholder="Bridge password"
                  placeholderTextColor="rgba(255,255,255,0.28)"
                  secureTextEntry
                  editable={!bridgeChecking && !bridgeAuthBusy && !passkeyBusy}
                  style={s.authInput}
                  onSubmitEditing={() => {
                    if (!bridgeChecking && !bridgeAuthBusy && !passkeyBusy) void unlockBridge()
                  }}
                />
                <Pressable
                  style={[
                    s.authButtonSecondary,
                    (bridgeChecking || bridgeAuthBusy || passkeyBusy) && { opacity: 0.6 }
                  ]}
                  onPress={() => {
                    if (!bridgeChecking && !bridgeAuthBusy && !passkeyBusy) void unlockBridge()
                  }}
                  disabled={bridgeChecking || bridgeAuthBusy || passkeyBusy}
                >
                  <Text style={s.authButtonSecondaryText}>
                    {bridgeChecking
                      ? 'Checking...'
                      : bridgeAuthBusy
                        ? 'Unlocking...'
                        : 'Unlock with password'}
                  </Text>
                </Pressable>
              </>
            )}
            {!!bridgeAuthError && <Text style={s.authError}>{bridgeAuthError}</Text>}
            {!passkeyConfigured && !passwordConfigured && (
              <Pressable
                style={s.authButtonSecondary}
                onPress={() => {
                  void refreshBridgeStatus()
                }}
              >
                <Text style={s.authButtonSecondaryText}>Check access</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}

      {isWeb && bridgeAuthenticated && passkeySupported && !passkeyConfigured && (
        <View style={s.passkeyHintWrap}>
          <View style={s.passkeyHintCard}>
            <Text style={s.passkeyHintTitle}>Enable fingerprint or PIN</Text>
            <Text style={s.passkeyHintCopy}>Save a passkey on this device so next unlock can use Android biometrics or system PIN instead of the bridge password.</Text>
            <Pressable
              style={[s.authButton, passkeyBusy && { opacity: 0.6 }]}
              onPress={() => { if (!passkeyBusy) void enablePasskey() }}
              disabled={passkeyBusy}
            >
              <Text style={s.authButtonText}>{passkeyBusy ? 'Waiting for device confirmation...' : 'Enable passkey'}</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* Camera preview -- web */}
      {showPreview && videoMode === 'camera' && isWeb && (
        <View style={s.previewContainer}>
          <View
            style={s.previewVideo}
            // @ts-ignore
            ref={(v: any) => {
              if (v && videoStreamRef.current && !v._streamAttached) {
                v._streamAttached = true
                const vid = document.createElement('video')
                vid.autoplay = true; vid.muted = true; vid.playsInline = true
                vid.style.cssText = 'width:100%;height:100%;object-fit:cover;border-radius:10px'
                vid.srcObject = videoStreamRef.current
                vid.play().catch(() => {})
                v.appendChild(vid)
              }
            }}
          />
          <Pressable style={s.previewClose} onPress={stopVideo}>
            <Text style={s.previewCloseText}>x</Text>
          </Pressable>
        </View>
      )}

      {/* Camera preview -- native */}
      {showPreview && videoMode === 'camera' && !isWeb && (
        <View style={s.previewContainer}>
          <CameraView
            ref={nativeCameraRef}
            style={s.previewVideo}
            facing={cameraFacing}
            flash="off"
            animateShutter={false}
          />
          <Pressable style={s.previewClose} onPress={stopVideo}>
            <Text style={s.previewCloseText}>x</Text>
          </Pressable>
          <Pressable
            style={[s.previewClose, { right: 28 }]}
            onPress={() => setCameraFacing(f => f === 'back' ? 'front' : 'back')}
          >
            <Text style={s.previewCloseText}>~</Text>
          </Pressable>
        </View>
      )}

      {/* === TAB CONTENT === */}
      {activeTab === 'orb' ? (
        /* -- LIVE TAB: spectrum + header + status + glass dock -- */
        <View style={s.liveFullscreen}>
          {/* Audio Spectrum (background, full area) */}
          <AudioSpectrum
            state={state}
            audioLevel={audioLevel}
            micLevel={micLevel}
            analyserRef={outputAnalyserRef}
          />

          {/* Header: centered M8 LIVE + menu icon */}
          <View style={s.header}>
            <View style={{ flex: 1 }} />
            <View style={s.headerCenter}>
              <Text style={s.headerM8}>M8 </Text>
              <Text style={s.headerLive}>LIVE</Text>
            </View>
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Pressable accessibilityRole="button" accessibilityLabel="Open settings" onPress={() => router.push('/settings')} style={{ padding: 8 }}>
                <Ionicons name="ellipsis-vertical" size={20} color="rgba(255,255,255,0.4)" />
              </Pressable>
            </View>
          </View>

          {/* Status area */}
          <View style={s.statusArea}>
            <Text style={[s.stateLabel, { color: stateColor }]}>{stateLabel}</Text>
            {!!lastModelText && (
              <Text style={s.transcriptText} numberOfLines={2}>{lastModelText}</Text>
            )}
            {showLiveBadge && (
              <View style={s.liveBadgeRow}>
                <View style={s.liveBadge}>
                  <View style={s.liveDot} />
                  <Text style={s.liveBadgeText}>LIVE</Text>
                </View>
              </View>
            )}
          </View>

          {/* Thinking / Searching badges */}
          {state === 'thinking' && (
            <View style={s.badgeWrap}>
              <PulseBadge label="Thinking..." color="#7C3AED" />
            </View>
          )}
          {state === 'searching' && (
            <View style={s.badgeWrap}>
              <PulseBadge label="Searching..." color="#D97706" />
            </View>
          )}

          {/* Glass dock -- draggable */}
          <View style={[s.glassDockWrap, { bottom: (isWeb ? 60 : 32) + Math.max(insets.bottom, 8) - (isWeb ? dockOffsetY : 0) }]}>
            {isWeb ? (
              // @ts-ignore web div for backdrop-filter
              <div
                onMouseDown={(e: any) => { dockDragStartY.current = e.clientY; dockDragStartOffset.current = dockOffsetY;
                  const onMove = (ev: any) => { setDockOffsetY(dockDragStartOffset.current + (ev.clientY - dockDragStartY.current)) };
                  const onUp = () => { document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp) };
                  document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
                }}
                onTouchStart={(e: any) => { const t = e.touches[0]; dockDragStartY.current = t.clientY; dockDragStartOffset.current = dockOffsetY;
                  const onMove = (ev: any) => { setDockOffsetY(dockDragStartOffset.current + (ev.touches[0].clientY - dockDragStartY.current)) };
                  const onUp = () => { document.removeEventListener('touchmove', onMove); document.removeEventListener('touchend', onUp) };
                  document.addEventListener('touchmove', onMove); document.addEventListener('touchend', onUp);
                }}
                style={{
                  cursor: 'grab',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 24,
                paddingLeft: 32, paddingRight: 32, paddingTop: 16, paddingBottom: 16,
                borderRadius: 40,
                background: 'rgba(38, 38, 38, 0.4)',
                backdropFilter: 'blur(32px)',
                WebkitBackdropFilter: 'blur(32px)',
                border: '1px solid rgba(255,255,255,0.1)',
                boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
              }}>
                {/* Camera button */}
                {supportsVision && (
                <Pressable
                  style={[s.dockBtn, !isConnected && { opacity: 0.3 }]}
                  onPress={() => videoMode === 'camera' ? stopVideo() : startVideo('camera')}
                  disabled={!isConnected}
                >
                  <Ionicons
                    name={videoMode === 'camera' ? 'videocam-off' : 'videocam'}
                    size={22}
                    color={videoMode === 'camera' ? '#f87171' : 'rgba(255,255,255,0.7)'}
                  />
                </Pressable>
                )}
                {/* Mic hero button */}
                <Pressable accessibilityRole="button" accessibilityLabel={micOn ? 'Stop microphone' : isConnected ? 'Use microphone' : 'Connect voice'}
                  style={[s.micHeroBtn, !micOn && isConnected && s.micHeroBtnOff]}
                  onPress={() => {
                    if (!isConnected) { connect(); return }
                    micOn ? stopMic() : startMic()
                  }}
                >
                  <Ionicons name={micOn ? 'mic' : 'mic-off'} size={28} color={micOn ? '#005d5d' : 'rgba(255,255,255,0.7)'} />
                </Pressable>
                {/* Speaker button */}
                <Pressable
                  style={[s.dockBtn, !isConnected && { opacity: 0.3 }]}
                  onPress={() => {
                    setSpeakerMuted(m => { speakerMutedRef.current = !m; return !m })
                  }}
                  disabled={!isConnected}
                >
                  <Ionicons name={speakerMuted ? 'volume-mute' : 'volume-high'} size={22} color={speakerMuted ? '#f87171' : 'rgba(255,255,255,0.7)'} />
                </Pressable>
                {/* Screen share -- web only */}
                {isWeb && supportsVision && (
                  <Pressable
                    style={[s.dockBtn, !isConnected && { opacity: 0.3 }]}
                    onPress={() => videoMode === 'screen' ? stopVideo() : startVideo('screen')}
                    disabled={!isConnected}
                  >
                    <Ionicons name="desktop-outline" size={22} color={videoMode === 'screen' ? '#f87171' : 'rgba(255,255,255,0.7)'} />
                  </Pressable>
                )}
              </div>
            ) : (
              /* Native: no backdrop-filter, use semi-transparent bg */
              <View style={s.glassDockNative}>
                {/* Camera */}
                {supportsVision && (
                <Pressable
                  style={[s.dockBtn, !isConnected && { opacity: 0.3 }]}
                  onPress={() => videoMode === 'camera' ? stopVideo() : startVideo('camera')}
                  disabled={!isConnected}
                >
                  <Ionicons
                    name={videoMode === 'camera' ? 'videocam-off' : 'videocam'}
                    size={22}
                    color={videoMode === 'camera' ? '#f87171' : 'rgba(255,255,255,0.7)'}
                  />
                </Pressable>
                )}
                {/* Mic hero */}
                <Pressable accessibilityRole="button" accessibilityLabel={micOn ? 'Stop microphone' : isConnected ? 'Use microphone' : 'Connect voice'}
                  style={[s.micHeroBtn, !micOn && isConnected && s.micHeroBtnOff]}
                  onPress={() => {
                    if (!isConnected) { connect(); return }
                    micOn ? stopMic() : startMic()
                  }}
                >
                  <Ionicons name={micOn ? 'mic' : 'mic-off'} size={28} color={micOn ? '#005d5d' : 'rgba(255,255,255,0.7)'} />
                </Pressable>
                {/* Speaker */}
                <Pressable
                  style={[s.dockBtn, !isConnected && { opacity: 0.3 }]}
                  onPress={() => {
                    setSpeakerMuted(m => { speakerMutedRef.current = !m; return !m })
                  }}
                  disabled={!isConnected}
                >
                  <Ionicons name={speakerMuted ? 'volume-mute' : 'volume-high'} size={22} color={speakerMuted ? '#f87171' : 'rgba(255,255,255,0.7)'} />
                </Pressable>
              </View>
            )}
          </View>
        </View>
      ) : (
        /* -- CHAT TAB: full conversation + input -- */
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={insets.top + 60}>
          <ScrollView
            ref={chatScrollRef}
            style={s.chat}
            contentContainerStyle={s.chatInner}
            keyboardShouldPersistTaps="handled"
          >
            {chat.length === 0 && (
              <Text style={s.emptyHint}>
                {isConnected ? 'Tap mic or type a message' : hostedWorkspace && state !== 'connecting' ? 'Tap the power button to connect.' : 'Connecting...'}
              </Text>
            )}
            {chat.map(m => (
              <View key={m.id} style={[s.bubble, m.role === 'user' ? s.bubbleUser : s.bubbleModel]}>
                <Text style={[s.bubbleText, m.role === 'user' && s.bubbleTextUser]}>{m.text}</Text>
                {typeof m.meta?.dispatchId === 'string' && (
                  <Text style={s.dispatchMeta}>
                    {typeof m.meta?.agentId === 'string' ? m.meta.agentId : 'agent'} · {typeof m.meta?.status === 'string' ? m.meta.status : 'queued'} · {m.meta.dispatchId.slice(0, 8)}
                  </Text>
                )}
              </View>
            ))}
          </ScrollView>

          {/* Chat bottom bar */}
          <View style={s.bottomBar}>
            <View style={s.waInputRow}>
              {supportsVision && (              <Pressable
                onPress={attachFile}
                disabled={!isConnected}
                style={[s.waIconBtn, !isConnected && { opacity: 0.3 }]}
              >
                <Ionicons name="attach" size={22} color="#9ca3af" />
              </Pressable>)}
              <TextInput
                accessibilityLabel="Message"
                value={draft}
                onChangeText={setDraft}
                onSubmitEditing={sendText}
                onBlur={handleInputBlur}
                placeholder="Type a message..."
                placeholderTextColor="rgba(255,255,255,0.2)"
                style={s.waInput}
                blurOnSubmit={false}
                editable={isConnected}
                maxLength={hostedWorkspace ? 4000 : undefined}
                returnKeyType="send"
                multiline={Platform.OS !== 'web'}
              />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={hostedWorkspace && !isConnected ? 'Connect conversation' : 'Send message'}
                onPress={() => { if (hostedWorkspace && !isConnected) void connect(); else void sendText() }}
                disabled={hostedWorkspace && !isConnected ? !bridgeAuthenticated || bridgeChecking || state === 'connecting' : !draft.trim() || !isConnected}
                style={[s.waSendBtn, (hostedWorkspace && !isConnected ? !bridgeAuthenticated || bridgeChecking || state === 'connecting' : !draft.trim() || !isConnected) && { opacity: 0.3 }]}
              >
                <Ionicons name={hostedWorkspace && !isConnected ? 'power' : 'send'} size={20} color="#fff" />
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}

      {/* === TAB BAR === */}
      <View style={[s.tabBar, { paddingBottom: insets.bottom }]}>
        <Pressable style={[s.tab, activeTab === 'orb' && s.tabActive]} onPress={() => setActiveTab('orb')}>
          <Ionicons name="radio" size={20} color={activeTab === 'orb' ? '#00ffff' : '#ababab'} />
          <Text style={[s.tabLabel, activeTab === 'orb' && s.tabLabelActive]}>LIVE</Text>
        </Pressable>
        <Pressable style={[s.tab, activeTab === 'chat' && s.tabActive]} onPress={() => { setActiveTab('chat'); scrollToBottom() }}>
          <Ionicons name="chatbubble-outline" size={20} color={activeTab === 'chat' ? '#00ffff' : '#ababab'} />
          <Text style={[s.tabLabel, activeTab === 'chat' && s.tabLabelActive]}>CHAT</Text>
        </Pressable>
      </View>
    </View>
  )
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },

  // Header -- centered M8 LIVE
  header: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 24, paddingVertical: 12,
    zIndex: 50,
  },
  headerCenter: { flexDirection: 'row', alignItems: 'center' },
  headerM8: {
    color: 'rgba(255,255,255,0.8)', fontSize: 14, fontWeight: '300',
    letterSpacing: 3, textTransform: 'uppercase',
  },
  headerLive: {
    color: '#00ffff', fontSize: 14, fontWeight: '300',
    letterSpacing: 3, textTransform: 'uppercase',
  },

  errorBar: { backgroundColor: 'rgba(42,8,8,0.8)', paddingHorizontal: 16, paddingVertical: 8, zIndex: 60 },
  errorText: { color: '#f87171', fontSize: 12 },
  authOverlay: {
    position: 'absolute', inset: 0,
    zIndex: 120,
    backgroundColor: 'rgba(0,0,0,0.82)',
    alignItems: 'center', justifyContent: 'center',
    paddingHorizontal: 20,
  },
  authCard: {
    width: '100%', maxWidth: 420,
    backgroundColor: '#111111',
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 18,
    gap: 12,
  },
  authTitle: { color: '#ffffff', fontSize: 22, fontWeight: '700' },
  authCopy: { color: 'rgba(255,255,255,0.72)', fontSize: 14, lineHeight: 20 },
  authInput: {
    borderRadius: 12,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    color: '#ffffff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
  },
  authError: { color: '#f87171', fontSize: 13 },
  authButton: {
    height: 46,
    borderRadius: 12,
    backgroundColor: '#00ffff',
    alignItems: 'center', justifyContent: 'center',
  },
  authButtonText: { color: '#041010', fontSize: 14, fontWeight: '800' },
  authButtonSecondary: {
    height: 46,
    borderRadius: 12,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.1)',
    alignItems: 'center', justifyContent: 'center',
  },
  authButtonSecondaryText: { color: '#ffffff', fontSize: 14, fontWeight: '700' },
  passkeyHintWrap: {
    position: 'absolute',
    top: 72,
    left: 12,
    right: 12,
    zIndex: 110,
  },
  passkeyHintCard: {
    borderRadius: 16,
    backgroundColor: 'rgba(17,17,17,0.95)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.08)',
    padding: 14,
    gap: 10,
  },
  passkeyHintTitle: { color: '#ffffff', fontSize: 16, fontWeight: '700' },
  passkeyHintCopy: { color: 'rgba(255,255,255,0.72)', fontSize: 13, lineHeight: 18 },

  // Live fullscreen
  liveFullscreen: {
    flex: 1, position: 'relative',
  },

  // Status area
  statusArea: {
    alignItems: 'center', paddingHorizontal: 24, zIndex: 50,
  },
  stateLabel: {
    fontSize: 10, fontWeight: '700', letterSpacing: 4,
    textTransform: 'uppercase', marginBottom: 4,
  },
  transcriptText: {
    color: 'rgba(255,255,255,0.9)', fontSize: 18, fontWeight: '300',
    letterSpacing: 0.5, textAlign: 'center', lineHeight: 26,
  },
  liveBadgeRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginTop: 12, gap: 16,
  },
  liveBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  liveDot: {
    width: 6, height: 6, borderRadius: 3, backgroundColor: '#00fc97',
  },
  liveBadgeText: {
    color: '#00fc97', fontSize: 8, fontWeight: '700', letterSpacing: 3,
  },

  badgeWrap: { alignItems: 'center', zIndex: 50, marginTop: 6, marginBottom: 8 },

  // Glass dock
  glassDockWrap: {
    position: 'absolute', left: 0, right: 0,
    alignItems: 'center', zIndex: 50,
  },
  glassDockNative: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24,
    paddingHorizontal: 32, paddingVertical: 16,
    borderRadius: 40,
    backgroundColor: 'rgba(38, 38, 38, 0.6)',
  },
  dockBtn: {
    width: 40, height: 40, borderRadius: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  micHeroBtn: {
    width: 64, height: 64, borderRadius: 32,
    backgroundColor: '#00ffff',
    alignItems: 'center', justifyContent: 'center',
    // Glow shadow
    shadowColor: '#00ffff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 30,
    elevation: 8,
  },
  micHeroBtnOff: {
    backgroundColor: '#1f1f1f',
    shadowOpacity: 0,
    elevation: 0,
  },

  // Chat
  chat: { flex: 1 },
  chatInner: { padding: 14, gap: 8, flexGrow: 1 },
  emptyHint: { color: 'rgba(255,255,255,0.15)', fontSize: 13, textAlign: 'center', marginTop: 20 },
  bubble: { borderRadius: 16, paddingHorizontal: 13, paddingVertical: 9, maxWidth: '84%' },
  bubbleUser: { backgroundColor: '#1a2a40', alignSelf: 'flex-end' },
  bubbleModel: { backgroundColor: '#191919', alignSelf: 'flex-start' },
  bubbleText: { color: '#e8ecf0', fontSize: 14, lineHeight: 21 },
  bubbleTextUser: { color: '#a8c8f0' },
  dispatchMeta: { color: 'rgba(255,255,255,0.34)', fontSize: 11, marginTop: 6, textTransform: 'uppercase', letterSpacing: 0.4 },

  // Bottom bar
  bottomBar: {
    backgroundColor: '#000000', paddingTop: 6, paddingBottom: 6, paddingHorizontal: 10,
  },
  waInputRow: {
    flexDirection: 'row', alignItems: 'flex-end', gap: 6,
  },
  waIconBtn: {
    width: 40, height: 40, alignItems: 'center', justifyContent: 'center',
  },
  waInput: {
    flex: 1, minHeight: 40, maxHeight: 100, borderRadius: 24,
    backgroundColor: '#191919',
    color: '#e8ecf0', paddingHorizontal: 16, paddingVertical: 9, fontSize: 14,
  },
  waSendBtn: {
    width: 40, height: 40, borderRadius: 20, backgroundColor: '#00ffff',
    alignItems: 'center', justifyContent: 'center',
  },

  // Camera preview
  previewContainer: {
    position: 'absolute' as const,
    top: 56, right: 10,
    width: 110, height: 148,
    zIndex: 100,
    borderRadius: 10,
    overflow: 'hidden',
  },
  previewVideo: { width: '100%', height: '100%', backgroundColor: '#000' },
  previewClose: {
    position: 'absolute' as const,
    top: 4, right: 4,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 10, width: 20, height: 20,
    alignItems: 'center', justifyContent: 'center',
  },
  previewCloseText: { color: '#fff', fontSize: 10, fontWeight: '700' },

  // Tab bar -- glass bg
  tabBar: {
    flexDirection: 'row',
    backgroundColor: 'rgba(0,0,0,0.8)',
  },
  tab: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    paddingVertical: 8, gap: 2,
  },
  tabActive: {},
  tabLabel: { fontSize: 10, fontWeight: '700', color: '#ababab', letterSpacing: 2 },
  tabLabelActive: { color: '#00ffff' },
})
