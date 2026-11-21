import React, { useEffect, useRef, useState, useCallback } from 'react'
import { Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, KeyboardAvoidingView, Keyboard, Animated as RNAnimated } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { CameraView, CameraType, useCameraPermissions } from 'expo-camera'
import * as FileSystem from 'expo-file-system/legacy'
import * as DocumentPicker from 'expo-document-picker'
import * as Haptics from 'expo-haptics'
import { Ionicons } from '@expo/vector-icons'

import { useSettings } from '../src/stores/settings'
import { isLocalDeviceTool, invokeLocalDeviceTool } from '../src/services/deviceTools'
import { isOpenClawTool, invokeOpenClawTool } from '../src/services/openclaw'
import { fetchWake, ackWake, type WakeRecord } from '../src/services/wake'
import { connectAppEventStream } from '../src/services/eventStream'
import { createBridgeSession, getBridgeSessionStatus } from '../src/services/bridgeSession'
import { authenticateBridgePasskey, isPasskeySupported, registerBridgePasskey } from '../src/services/passkey'
import { decideNotificationHandling } from '../src/services/notificationPolicy'
import type { AppEvent, SessionState } from '../src/types/realtime'

import NativeOrb from '../components/NativeOrb'
import ThreeOrb from '../components/ThreeOrb'
import AudioSpectrum from '../components/AudioSpectrum'
import PulseBadge from '../components/PulseBadge'
import BridgeAuthGate from '../components/BridgeAuthGate'

import { useAudioEngine } from '../hooks/useAudioEngine'
import { useMicRecorder } from '../hooks/useMicRecorder'
import { useVideoCapture } from '../hooks/useVideoCapture'
import { useGeminiSession } from '../hooks/useGeminiSession'

type ChatRole = 'user' | 'model'
type ChatItem = { id: string; role: ChatRole; text: string; meta?: Record<string, unknown> }
function uid(p = 'msg') { return `${p}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` }

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
  const [videoMode, setVideoMode] = useState<'none' | 'camera' | 'screen'>('none')
  const [showPreview, setShowPreview] = useState(false)
  const [cameraFacing, setCameraFacing] = useState<CameraType>('back')
  const [activeTab, setActiveTab] = useState<'orb' | 'chat'>('orb')
  const [audioLevel, setAudioLevel] = useState(0)
  const [micLevel, setMicLevel] = useState(0)
  const [speakerMuted, setSpeakerMuted] = useState(false)
  const speakerMutedRef = useRef(false)
  const [dockOffsetY, setDockOffsetY] = useState(0)
  const dockDragStartY = useRef(0)
  const dockDragStartOffset = useRef(0)

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
    return () => { showSub.remove(); hideSub.remove() }
  }, [])

  const handleInputBlur = useCallback(() => {
    if (Platform.OS !== 'web') {
      setTimeout(() => {
        setKeyboardVisible(false)
        RNAnimated.timing(orbHeightAnim, { toValue: 1, duration: 250, useNativeDriver: false }).start()
      }, 100)
    }
  }, [])

  const [bridgeAuthenticated, setBridgeAuthenticated] = useState(!isWeb)
  const [bridgeChecking, setBridgeChecking] = useState(isWeb)
  const [bridgePassword, setBridgePassword] = useState('')
  const [bridgeAuthBusy, setBridgeAuthBusy] = useState(false)
  const [bridgeAuthError, setBridgeAuthError] = useState('')
  const [passkeySupported, setPasskeySupported] = useState(isWeb ? isPasskeySupported() : false)
  const [passkeyConfigured, setPasskeyConfigured] = useState(false)
  const [passkeyBusy, setPasskeyBusy] = useState(false)

  const [cameraPermission, requestCameraPermission] = useCameraPermissions()

  const wsRef = useRef<WebSocket | null>(null)
  const micOnRef = useRef(false)
  const micPausedRef = useRef(false)
  const pendingWakeRef = useRef<WakeRecord | null>(null)
  const processedWakeIdRef = useRef<string | null>(null)
  const chatScrollRef = useRef<ScrollView | null>(null)
  const eventStreamCleanupRef = useRef<null | (() => void)>(null)

  const startMicActionRef = useRef<() => Promise<void>>(async () => {})
  const stopMicActionRef = useRef<() => Promise<void>>(async () => {})
  const startVideoActionRef = useRef<(mode: 'camera' | 'screen') => Promise<void>>(async () => {})
  const stopVideoActionRef = useRef<() => void>(() => {})

  const modelBufRef = useRef('')
  const userBufRef = useRef('')

  const scrollToBottom = useCallback(() => {
    setTimeout(() => chatScrollRef.current?.scrollToEnd?.({ animated: true }), 60)
  }, [])

  const addMsg = useCallback((role: ChatRole, text: string, meta?: ChatItem['meta']) => {
    const t = text.trim()
    if (!t) return
    setChat(prev => [...prev, { id: uid(), role, text: t, meta }])
    scrollToBottom()
  }, [scrollToBottom])

  const appendStreaming = useCallback((kind: 'user' | 'model', chunk: string) => {
    if (kind === 'model') {
      modelBufRef.current += chunk
      const text = modelBufRef.current
      setChat(prev => {
        const last = prev[prev.length - 1]
        if (last?.id === 'model-streaming') return [...prev.slice(0, -1), { ...last, text }]
        return [...prev, { id: 'model-streaming', role: 'model', text }]
      })
    } else {
      userBufRef.current = chunk
      const text = chunk
      setChat(prev => {
        const last = prev[prev.length - 1]
        if (last?.id === 'user-streaming') return [...prev.slice(0, -1), { ...last, text }]
        return [...prev, { id: 'user-streaming', role: 'user', text }]
      })
    }
  }, [])

  const finalizeStreaming = useCallback(() => {
    setChat(prev => prev.map(m =>
      m.id === 'model-streaming' ? { ...m, id: uid('model') } :
      m.id === 'user-streaming' ? { ...m, id: uid('user') } : m
    ))
    modelBufRef.current = ''
    userBufRef.current = ''
    scrollToBottom()
  }, [scrollToBottom])

  const { playAudio, clearAudioQueue, getAudioCtx, outputAnalyserRef, drainAudioQueue } = useAudioEngine({
    isWeb, speakerMutedRef, setAudioLevel, micOnRef, micPausedRef, state
  })

  const { startMic, stopMic, micStreamRef } = useMicRecorder({
    isWeb, wsRef, getAudioCtx, micOnRef, micPausedRef, setState, setError, setMicLevel, setMicOn, micOn
  })

  const { startVideo, stopVideo, videoStreamRef, nativeCameraRef, videoStreamAttachedRef } = useVideoCapture({
    isWeb, wsRef, cameraPermission, requestCameraPermission, setVideoMode, setShowPreview, setError, micOnRef, startMicActionRef
  })

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
  }, [isWeb, clearAudioQueue])

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
      // HIDDEN TOOL ARGS
      addMsg('user', `[Tool: ${call.name}]`)
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
  }, [addMsg, cameraPermission?.granted, isWeb, getAudioCtx])

  const { connect, disconnect, enqueueNotification } = useGeminiSession({
    isWeb, wsRef, setState, setError, stopMic, stopVideo, settings, pendingWakeRef, injectWakeIntoGemini, handleToolCall, clearAudioQueue, micPausedRef, appendStreaming, finalizeStreaming, setAudioLevel, micOnRef
  })

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

    const decision = decideNotificationHandling(event, { micOn: micOnRef.current, state })
    if (decision === 'ignore') return

    const label = event.title?.trim() ? `[${event.title.trim()}] ` : '[Notification] '
    const text = `${label}${String(event.text || '').trim()}`.trim()
    if (!text) return

    addMsg('model', text)

    if (decision === 'interrupt') {
      clearAudioQueue()
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ realtimeInput: { text } }))
        setState('thinking')
      }
    } else if (decision === 'queue') {
      enqueueNotification(text)
    }
  }, [addMsg, state, injectWakeIntoGemini, clearAudioQueue, enqueueNotification])

  useEffect(() => { startMicActionRef.current = startMic }, [startMic])
  useEffect(() => { stopMicActionRef.current = stopMic }, [stopMic])
  useEffect(() => { startVideoActionRef.current = startVideo }, [startVideo])
  useEffect(() => { stopVideoActionRef.current = stopVideo }, [stopVideo])

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
    if (!text || !isConnected) return
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
      setBridgeAuthenticated(true)
      setPasskeySupported(Boolean(status.passkeySupported ?? isPasskeySupported()))
      setPasskeyConfigured(Boolean(status.passkeyConfigured))
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
      await registerBridgePasskey()
      setPasskeyConfigured(true)
    } catch (e) {
      setBridgeAuthError(String((e as Error).message || e))
    } finally {
      setPasskeyBusy(false)
    }
  }, [])

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
        if (!mounted) return
        setBridgeAuthenticated(Boolean(status.authenticated))
        setPasskeySupported(Boolean(status.passkeySupported ?? isPasskeySupported()))
        setPasskeyConfigured(Boolean(status.passkeyConfigured))
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
    connect()
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
      onError: (streamError) => {},
    })
    return () => {
      eventStreamCleanupRef.current?.()
      eventStreamCleanupRef.current = null
    }
  }, [bridgeAuthenticated, bridgeChecking, handleExternalEvent, isWeb])

  const attachFile = useCallback(async () => {
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
    if (isWeb) {
      const input = document.createElement('input')
      input.type = 'file'
      input.accept = 'image/*,application/pdf,text/*,.txt,.md,.json,.csv'
      input.onchange = async (e) => {
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
      }
      input.click()
      return
    }
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
    } catch (e) {}
  }, [isWeb, addMsg])

  const isConnected = state === 'ready' || state === 'listening' || state === 'responding' || state === 'thinking' || state === 'searching'

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

  const lastModelText = (() => {
    for (let i = chat.length - 1; i >= 0; i--) {
      if (chat[i].role === 'model' && chat[i].text.trim()) return chat[i].text.trim()
    }
    return ''
  })()

  const showLiveBadge = state === 'ready' || state === 'listening' || state === 'responding' || state === 'thinking' || state === 'searching'

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {!!error && (
        <Pressable style={s.errorBar} onPress={() => { setError(''); connect() }}>
          <Text style={s.errorText}>{error} -- tap to retry</Text>
        </Pressable>
      )}

      <BridgeAuthGate 
        bridgeAuthenticated={bridgeAuthenticated}
        bridgeChecking={bridgeChecking}
        passkeySupported={passkeySupported}
        passkeyConfigured={passkeyConfigured}
        passkeyBusy={passkeyBusy}
        bridgePassword={bridgePassword}
        bridgeAuthBusy={bridgeAuthBusy}
        bridgeAuthError={bridgeAuthError}
        setBridgePassword={setBridgePassword}
        setBridgeAuthError={setBridgeAuthError}
        unlockBridge={unlockBridge}
        unlockWithPasskey={unlockWithPasskey}
        enablePasskey={enablePasskey}
      />

      {showPreview && videoMode === 'camera' && isWeb && (
        <View style={s.previewContainer}>
          <View
            style={s.previewVideo}
            // @ts-ignore
            ref={(v: any) => {
              if (v && videoStreamRef.current && !videoStreamAttachedRef.current) {
                videoStreamAttachedRef.current = true
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

      {activeTab === 'orb' ? (
        <View style={s.liveFullscreen}>
          <AudioSpectrum
            state={state}
            audioLevel={audioLevel}
            micLevel={micLevel}
            analyserRef={outputAnalyserRef}
          />

          <View style={s.header}>
            <View style={{ flex: 1 }} />
            <View style={s.headerCenter}>
              <Text style={s.headerM8}>M8 </Text>
              <Text style={s.headerLive}>LIVE</Text>
            </View>
            <View style={{ flex: 1, alignItems: 'flex-end' }}>
              <Pressable onPress={isConnected ? disconnect : connect} style={{ padding: 8 }}>
                <Ionicons name="ellipsis-vertical" size={20} color="rgba(255,255,255,0.4)" />
              </Pressable>
            </View>
          </View>

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

          <RNAnimated.View style={[s.orbWrap, { transform: [{ scale: orbHeightAnim }] }]}>
            {isWeb ? (
              <ThreeOrb state={state} micLevel={micLevel} />
            ) : (
              <NativeOrb
                state={state}
                micLevel={micLevel}
                audioLevel={audioLevel}
              />
            )}
          </RNAnimated.View>

          <View style={[s.glassDockWrap, { bottom: (isWeb ? 60 : 32) + Math.max(insets.bottom, 8) - (isWeb ? dockOffsetY : 0) }]}>
            {isWeb ? (
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
                <Pressable
                  style={[s.micHeroBtn, !micOn && isConnected && s.micHeroBtnOff]}
                  onPress={() => {
                    if (!isConnected) { connect(); return }
                    micOn ? stopMic() : startMic()
                  }}
                >
                  <Ionicons name={micOn ? 'mic' : 'mic-off'} size={28} color={micOn ? '#005d5d' : 'rgba(255,255,255,0.7)'} />
                </Pressable>
                <Pressable
                  style={[s.dockBtn, !isConnected && { opacity: 0.3 }]}
                  onPress={() => {
                    setSpeakerMuted(m => { speakerMutedRef.current = !m; return !m })
                  }}
                  disabled={!isConnected}
                >
                  <Ionicons name={speakerMuted ? 'volume-mute' : 'volume-high'} size={22} color={speakerMuted ? '#f87171' : 'rgba(255,255,255,0.7)'} />
                </Pressable>
                {isWeb && (
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
              <View style={s.glassDockNative}>
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
                <Pressable
                  style={[s.micHeroBtn, !micOn && isConnected && s.micHeroBtnOff]}
                  onPress={() => {
                    if (!isConnected) { connect(); return }
                    micOn ? stopMic() : startMic()
                  }}
                >
                  <Ionicons name={micOn ? 'mic' : 'mic-off'} size={28} color={micOn ? '#005d5d' : 'rgba(255,255,255,0.7)'} />
                </Pressable>
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
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding" keyboardVerticalOffset={insets.top + 60}>
          <ScrollView
            ref={chatScrollRef}
            style={s.chat}
            contentContainerStyle={s.chatInner}
            keyboardShouldPersistTaps="handled"
          >
            {chat.length === 0 && (
              <Text style={s.emptyHint}>
                {isConnected ? 'Tap mic or type a message' : 'Connecting...'}
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

          <View style={s.bottomBar}>
            <View style={s.waInputRow}>
              <Pressable
                onPress={attachFile}
                disabled={!isConnected}
                style={[s.waIconBtn, !isConnected && { opacity: 0.3 }]}
              >
                <Ionicons name="attach" size={22} color="#9ca3af" />
              </Pressable>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                onSubmitEditing={sendText}
                onBlur={handleInputBlur}
                placeholder="Type a message..."
                placeholderTextColor="rgba(255,255,255,0.2)"
                style={s.waInput}
                blurOnSubmit={false}
                editable={isConnected}
                returnKeyType="send"
                multiline={Platform.OS !== 'web'}
              />
              <Pressable
                onPress={sendText}
                disabled={!draft.trim() || !isConnected}
                style={[s.waSendBtn, (!draft.trim() || !isConnected) && { opacity: 0.3 }]}
              >
                <Ionicons name="send" size={20} color="#fff" />
              </Pressable>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}

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
  liveFullscreen: { flex: 1, position: 'relative' },
  statusArea: { alignItems: 'center', paddingHorizontal: 24, zIndex: 50 },
  stateLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 4, textTransform: 'uppercase', marginBottom: 4 },
  transcriptText: { color: 'rgba(255,255,255,0.9)', fontSize: 18, fontWeight: '300', letterSpacing: 0.5, textAlign: 'center', lineHeight: 26 },
  liveBadgeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: 12, gap: 16 },
  liveBadge: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 20, backgroundColor: 'rgba(0,0,0,0.4)' },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#00fc97' },
  liveBadgeText: { color: '#00fc97', fontSize: 8, fontWeight: '700', letterSpacing: 3 },
  badgeWrap: { alignItems: 'center', zIndex: 50, marginTop: 6, marginBottom: 8 },
  glassDockWrap: { position: 'absolute', left: 0, right: 0, alignItems: 'center', zIndex: 50 },
  glassDockNative: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 24, paddingHorizontal: 32, paddingVertical: 16, borderRadius: 40, backgroundColor: 'rgba(38, 38, 38, 0.6)' },
  dockBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  micHeroBtn: { width: 64, height: 64, borderRadius: 32, backgroundColor: '#00ffff', alignItems: 'center', justifyContent: 'center', shadowColor: '#00ffff', shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.4, shadowRadius: 30, elevation: 8 },
  micHeroBtnOff: { backgroundColor: '#1f1f1f', shadowOpacity: 0, elevation: 0 },
  chat: { flex: 1, backgroundColor: '#000' },
  chatInner: { padding: 16, paddingBottom: 32, gap: 12 },
  emptyHint: { textAlign: 'center', color: '#666', marginTop: 40, fontSize: 13 },
  bubble: { maxWidth: '85%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16 },
  bubbleUser: { alignSelf: 'flex-end', backgroundColor: '#004a4a', borderBottomRightRadius: 4 },
  bubbleModel: { alignSelf: 'flex-start', backgroundColor: '#161616', borderBottomLeftRadius: 4 },
  bubbleText: { color: '#e5e7eb', fontSize: 15, lineHeight: 22 },
  bubbleTextUser: { color: '#ffffff' },
  dispatchMeta: { color: 'rgba(255,255,255,0.4)', fontSize: 10, marginTop: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  bottomBar: { backgroundColor: '#050505', borderTopWidth: 1, borderColor: '#1a1a1a', paddingHorizontal: 12, paddingVertical: 10 },
  waInputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  waIconBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  waInput: { flex: 1, minHeight: 40, maxHeight: 120, backgroundColor: '#1a1a1a', borderRadius: 20, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 10, color: '#fff', fontSize: 15 },
  waSendBtn: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#00ffff', alignItems: 'center', justifyContent: 'center' },
  tabBar: { flexDirection: 'row', backgroundColor: '#080808', borderTopWidth: 1, borderColor: '#161616' },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 12, gap: 4 },
  tabActive: { backgroundColor: '#111' },
  tabLabel: { fontSize: 10, fontWeight: '700', color: '#ababab' },
  tabLabelActive: { color: '#00ffff' },
  previewContainer: { position: 'absolute', top: 16, right: 16, width: 120, height: 160, borderRadius: 12, zIndex: 100, overflow: 'hidden', backgroundColor: '#000', borderWidth: 1, borderColor: 'rgba(255,255,255,0.2)' },
  previewVideo: { width: '100%', height: '100%' },
  previewClose: { position: 'absolute', top: 6, right: 6, width: 20, height: 20, borderRadius: 10, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  previewCloseText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  orbWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', marginTop: -40 },
})
