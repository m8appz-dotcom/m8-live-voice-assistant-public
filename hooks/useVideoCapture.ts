import { useCallback, useRef } from 'react'
import { Platform } from 'react-native'
import type { CameraView } from 'expo-camera'

function canvasToB64(canvas: HTMLCanvasElement, quality = 0.7): string {
  const dataUrl = canvas.toDataURL('image/jpeg', quality)
  return dataUrl.split(',')[1]
}

export function useVideoCapture({
  isWeb,
  wsRef,
  cameraPermission,
  requestCameraPermission,
  setVideoMode,
  setShowPreview,
  setError,
  micOnRef,
  startMicActionRef
}: any) {
  const videoStreamRef = useRef<MediaStream | null>(null)
  const videoElRef = useRef<HTMLVideoElement | null>(null)
  const videoCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const frameIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const videoModeRef = useRef<'none' | 'camera' | 'screen'>('none')
  const nativeCameraRef = useRef<CameraView | null>(null)
  const videoStreamAttachedRef = useRef(false)

  const stopCameraNative = useCallback(() => {
    if (frameIntervalRef.current) { clearInterval(frameIntervalRef.current); frameIntervalRef.current = null }
    videoModeRef.current = 'none'
    setVideoMode('none')
    setShowPreview(false)
  }, [setVideoMode, setShowPreview])

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
          animateShutter: false,
        } as any)
        if (!(photo as any)?.base64) return
        wsRef.current.send(JSON.stringify({
          realtimeInput: { video: { data: (photo as any).base64, mimeType: 'image/jpeg' } },
        }))
      } catch {}
    }, 1000)
  }, [cameraPermission, requestCameraPermission, wsRef, setVideoMode, setShowPreview, setError])

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
    videoStreamAttachedRef.current = false
    videoModeRef.current = 'none'
    setVideoMode('none')
    setShowPreview(false)
  }, [isWeb, stopCameraNative, setVideoMode, setShowPreview])

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

      if (!micOnRef.current && startMicActionRef.current) {
        await startMicActionRef.current()
      }

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
        try {
          stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: { ideal: 'environment' } }, audio: false })
        } catch {
          stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false })
        }
      } else {
        stream = await (navigator.mediaDevices as any).getDisplayMedia({ video: { frameRate: 1 }, audio: false })
      }
      videoStreamRef.current = stream

      const el = document.createElement('video')
      el.autoplay = true; el.muted = true; el.playsInline = true
      el.setAttribute('playsinline', '')
      el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px'
      document.body.appendChild(el)
      videoElRef.current = el
      el.srcObject = stream

      const cv = document.createElement('canvas')
      cv.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px'
      document.body.appendChild(cv)
      videoCanvasRef.current = cv

      el.play().catch(() => {})

      frameIntervalRef.current = setInterval(() => {
        const ws = wsRef.current
        if (!ws || ws.readyState !== WebSocket.OPEN) return
        const video = videoElRef.current
        const canvas = videoCanvasRef.current
        if (!video || !canvas) return
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
  }, [isWeb, stopVideo, startCameraNative, wsRef, setError, micOnRef, startMicActionRef, setVideoMode, setShowPreview])

  return { startVideo, stopVideo, videoStreamRef, nativeCameraRef, videoStreamAttachedRef }
}
