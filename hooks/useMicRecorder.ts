import { useCallback, useRef, useEffect } from 'react'
import { Platform } from 'react-native'
import { useAudioRecorder } from '@siteed/expo-audio-studio'
import type { AudioDataEvent } from '@siteed/expo-audio-studio'

function downsample(input: Float32Array, inRate: number, outRate = 16000) {
  const ratio = inRate / outRate
  const out = new Int16Array(Math.round(input.length / ratio))
  for (let i = 0; i < out.length; i++) {
    const s = Math.round(i * ratio), e = Math.round((i + 1) * ratio)
    let sum = 0, cnt = 0
    for (let j = s; j < e && j < input.length; j++) { sum += input[j]; cnt++ }
    const v = cnt ? Math.max(-1, Math.min(1, sum / cnt)) : 0
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff
  }
  return out
}

function pcm16ToB64(i16: Int16Array) {
  const bytes = new Uint8Array(i16.buffer)
  let bin = ''
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i])
  return globalThis.btoa(bin)
}

export function useMicRecorder({
  isWeb,
  wsRef,
  getAudioCtx,
  micOnRef,
  micPausedRef,
  setState,
  setError,
  setMicLevel,
  setMicOn,
  micOn
}: any) {
  const micStreamRef = useRef<MediaStream | null>(null)
  const audioSrcRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const workletNodeRef = useRef<AudioWorkletNode | null>(null)
  const micAnimRef = useRef<number>(0)
  
  const { startRecording: startNativeRecording, stopRecording: stopNativeRecording } = useAudioRecorder()

  useEffect(() => {
    if (!isWeb || !micOn || !micStreamRef.current) {
      if (micAnimRef.current) cancelAnimationFrame(micAnimRef.current)
      setMicLevel(0)
      return
    }
    let mounted = true
    getAudioCtx().then((ctx: AudioContext) => {
      let analyser: AnalyserNode
      let source: MediaStreamAudioSourceNode
      try {
        analyser = ctx.createAnalyser()
        analyser.fftSize = 256
        analyser.smoothingTimeConstant = 0.8
        source = ctx.createMediaStreamSource(micStreamRef.current!)
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
    })
    return () => {
      mounted = false
      if (micAnimRef.current) cancelAnimationFrame(micAnimRef.current)
      setMicLevel(0)
    }
  }, [isWeb, micOn, getAudioCtx, setMicLevel])

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
          if (typeof data !== 'string') return
          wsRef.current?.send(JSON.stringify({
            realtimeInput: { audio: { data, mimeType: 'audio/pcm;rate=16000' } },
          }))
          setMicLevel(Math.min(1, (event.eventDataSize / 3200) * 0.8))
        },
      })
      micOnRef.current = true
      setMicOn(true)
      setState('listening')
    } catch (e) {
      setError('Mic: ' + String((e as Error).message || e))
    }
  }, [startNativeRecording, wsRef, micOnRef, micPausedRef, setState, setMicOn, setMicLevel, setError])

  const stopMicNative = useCallback(async () => {
    try { await stopNativeRecording() } catch {}
    if (micOnRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }))
    }
    micOnRef.current = false
    setMicOn(false)
    setMicLevel(0)
  }, [stopNativeRecording, wsRef, micOnRef, setMicOn, setMicLevel])

  const startMic = useCallback(async () => {
    if (isWeb) {
      if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) return
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, sampleRate: 16000 } })
        micStreamRef.current = stream
        const ctx = await getAudioCtx()
        
        try {
          await ctx.audioWorklet.addModule('/mic-processor.worklet.js')
        } catch(e) {
          // May be already added
        }
        
        const source = ctx.createMediaStreamSource(stream)
        const workletNode = new AudioWorkletNode(ctx, 'mic-processor')
        
        workletNode.port.onmessage = (e) => {
          if (!micOnRef.current || micPausedRef.current) return
          const input = e.data
          const pcm = downsample(input, ctx.sampleRate, 16000)
          wsRef.current?.send(JSON.stringify({
            realtimeInput: { audio: { data: pcm16ToB64(pcm), mimeType: 'audio/pcm;rate=16000' } },
          }))
        }
        
        source.connect(workletNode)
        workletNode.connect(ctx.destination)
        
        audioSrcRef.current = source
        workletNodeRef.current = workletNode
        micOnRef.current = true
        setMicOn(true)
        setState('listening')
      } catch (e) {
        setError('Mic: ' + String((e as Error).message || e))
      }
    } else {
      await startMicNative()
    }
  }, [isWeb, startMicNative, wsRef, getAudioCtx, micOnRef, micPausedRef, setState, setMicOn, setError])

  const stopMic = useCallback(async () => {
    if (isWeb) {
      if (micOnRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }))
      }
      try { workletNodeRef.current?.disconnect() } catch {}
      try { audioSrcRef.current?.disconnect() } catch {}
      micStreamRef.current?.getTracks().forEach(t => t.stop())
      workletNodeRef.current = null; audioSrcRef.current = null; micStreamRef.current = null
      micOnRef.current = false; micPausedRef.current = false
      setMicOn(false)
    } else {
      await stopMicNative()
    }
  }, [isWeb, stopMicNative, wsRef, micOnRef, micPausedRef, setMicOn])

  return { startMic, stopMic, micStreamRef }
}
