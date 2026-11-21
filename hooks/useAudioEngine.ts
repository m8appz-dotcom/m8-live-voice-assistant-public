import { useRef, useCallback, useEffect } from 'react'
import { Platform } from 'react-native'
import { Audio, AVPlaybackStatus } from 'expo-av'
import * as FileSystem from 'expo-file-system/legacy'

function concatPcmB64(chunks: string[]): string {
  if (chunks.length === 1) return chunks[0]
  const arrays = chunks.map(b64 => {
    const bin = globalThis.atob(b64)
    const arr = new Uint8Array(bin.length)
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i)
    return arr
  })
  const total = arrays.reduce((s, a) => s + a.length, 0)
  const out = new Uint8Array(total)
  let offset = 0
  for (const a of arrays) { out.set(a, offset); offset += a.length }
  let bin = ''
  const chunkSize = 8192
  for (let i = 0; i < out.length; i += chunkSize) {
    bin += String.fromCharCode(...out.subarray(i, i + chunkSize))
  }
  return globalThis.btoa(bin)
}

function b64ToArrayBuffer(b64: string) {
  const bin = globalThis.atob(b64)
  const buf = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i)
  return buf.buffer
}

function pcm16ToAudioBuffer(ctx: AudioContext, b64: string, sr = 24000) {
  const dv = new DataView(b64ToArrayBuffer(b64))
  const n = dv.byteLength / 2
  const ab = ctx.createBuffer(1, n, sr)
  const ch = ab.getChannelData(0)
  for (let i = 0; i < n; i++) ch[i] = dv.getInt16(i * 2, true) / 32768
  return ab
}

function calcPcmRms(b64: string): number {
  try {
    const bin = globalThis.atob(b64)
    const len = bin.length
    if (len < 4) return 0
    const sampleCount = len / 2
    let sumSq = 0
    const step = Math.max(1, Math.floor(sampleCount / 200))
    let counted = 0
    for (let i = 0; i < sampleCount; i += step) {
      const lo = bin.charCodeAt(i * 2)
      const hi = bin.charCodeAt(i * 2 + 1)
      const sample = (hi << 8) | lo
      const signed = sample >= 0x8000 ? sample - 0x10000 : sample
      const norm = signed / 32768
      sumSq += norm * norm
      counted++
    }
    return Math.min(1, Math.sqrt(sumSq / counted) * 3.5)
  } catch { return 0 }
}

export function useAudioEngine({
  isWeb,
  speakerMutedRef,
  setAudioLevel,
  micOnRef,
  micPausedRef,
  state
}: {
  isWeb: boolean;
  speakerMutedRef: React.MutableRefObject<boolean>;
  setAudioLevel: (v: number) => void;
  micOnRef: React.MutableRefObject<boolean>;
  micPausedRef: React.MutableRefObject<boolean>;
  state: string;
}) {
  const audioCtxRef = useRef<AudioContext | null>(null)
  const outputAnalyserRef = useRef<AnalyserNode | null>(null)
  const nextStartRef = useRef(0)

  const audioQueueRef = useRef<string[]>([])
  const audioPlayingRef = useRef(false)
  const audioModeSetRef = useRef(false)
  const nativePcmBufferRef = useRef<string[]>([])
  const nativePlaybackStartedRef = useRef(false)
  
  const NATIVE_BUFFER_THRESHOLD = 1
  const NATIVE_BATCH_SIZE = 3

  const getAudioCtx = async () => {
    if (!audioCtxRef.current) {
      audioCtxRef.current = new window.AudioContext()
      nextStartRef.current = audioCtxRef.current.currentTime
      const analyser = audioCtxRef.current.createAnalyser()
      analyser.fftSize = 256
      analyser.smoothingTimeConstant = 0.8
      analyser.connect(audioCtxRef.current.destination)
      outputAnalyserRef.current = analyser
    }
    if (audioCtxRef.current.state === 'suspended') await audioCtxRef.current.resume()
    return audioCtxRef.current
  }

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
  }, [isWeb, state, setAudioLevel])

  const playNativeChunk = useCallback(async (b64: string) => {
    const shouldResumeMic = micOnRef.current && !micPausedRef.current
    if (shouldResumeMic) micPausedRef.current = true
    try {
      if (!audioModeSetRef.current) {
        audioModeSetRef.current = true
        await Audio.setAudioModeAsync({
          allowsRecordingIOS: false,
          playsInSilentModeIOS: true,
          staysActiveInBackground: false,
          shouldDuckAndroid: false,
        })
      }

      const rawBytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0))
      const dataLen = rawBytes.length
      const sampleRate = 24000
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
          Audio.Sound.createAsync(
            { uri },
            { shouldPlay: true, volume: 1.0 }
          ).then(({ sound }) => {
            sound.setOnPlaybackStatusUpdate((status: AVPlaybackStatus) => {
              if ('didJustFinish' in status && status.didJustFinish) {
                sound.unloadAsync().catch(() => {})
                cleanup?.()
                resolve()
              }
            })
          }).catch((e) => {
            cleanup?.()
            reject(e)
          })
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
  }, [micOnRef, micPausedRef])

  const drainAudioQueue = useCallback(async () => {
    if (audioPlayingRef.current) return
    audioPlayingRef.current = true
    while (audioQueueRef.current.length > 0) {
      const chunks = audioQueueRef.current.splice(0, audioQueueRef.current.length)
      const combined = concatPcmB64(chunks)
      await playNativeChunk(combined)
    }
    audioPlayingRef.current = false
    if (nativePcmBufferRef.current.length > 0) {
      const remaining = nativePcmBufferRef.current.splice(0, nativePcmBufferRef.current.length)
      const combined = concatPcmB64(remaining)
      audioQueueRef.current.push(combined)
      nativePlaybackStartedRef.current = false
      drainAudioQueue()
    }
  }, [playNativeChunk])

  const enqueueNativeAudio = useCallback((b64: string) => {
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
  }, [drainAudioQueue, setAudioLevel])

  const playAudio = useCallback(async (b64: string) => {
    if (speakerMutedRef.current) return
    if (isWeb) {
      const ctx = await getAudioCtx()
      const buf = pcm16ToAudioBuffer(ctx, b64, 24000)
      const src = ctx.createBufferSource()
      src.buffer = buf
      if (outputAnalyserRef.current) {
        src.connect(outputAnalyserRef.current)
      } else {
        src.connect(ctx.destination)
      }
      const when = Math.max(ctx.currentTime, nextStartRef.current)
      src.start(when)
      nextStartRef.current = when + buf.duration
    } else {
      enqueueNativeAudio(b64)
    }
  }, [isWeb, enqueueNativeAudio, speakerMutedRef])

  const clearAudioQueue = useCallback(() => {
    if (audioCtxRef.current) {
      nextStartRef.current = audioCtxRef.current.currentTime
    }
    audioQueueRef.current = []
    nativePcmBufferRef.current = []
    nativePlaybackStartedRef.current = false
  }, [])

  return {
    playAudio,
    clearAudioQueue,
    getAudioCtx,
    outputAnalyserRef,
    nativePcmBufferRef,
    audioQueueRef,
    drainAudioQueue,
    nativePlaybackStartedRef
  }
}
