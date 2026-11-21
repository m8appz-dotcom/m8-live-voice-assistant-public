import { appendBridgeToken, getProxyBase, toWebSocketUrl } from './appConfig'
import type { AppEvent, ExternalEventHandler } from '../types/realtime'

export function connectAppEventStream(options: {
  isWeb?: boolean
  onEvent: ExternalEventHandler
  onError?: (error: Error) => void
}) {
  const baseUrl = getProxyBase(options.isWeb)
  const wsUrl = options.isWeb ? toWebSocketUrl(window.location.origin, '/events') : toWebSocketUrl(baseUrl, '/events')
  let closedByApp = false
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let ws: WebSocket | null = null

  const open = () => {
    if (closedByApp) return
    ws = new WebSocket(appendBridgeToken(wsUrl))

    ws.onmessage = (event) => {
      try {
        const parsed = JSON.parse(typeof event.data === 'string' ? event.data : String(event.data)) as AppEvent
        options.onEvent(parsed)
      } catch (error) {
        options.onError?.(error as Error)
      }
    }

    ws.onerror = () => options.onError?.(new Error('Event stream error'))
    ws.onclose = () => {
      if (closedByApp || retryTimer) return
      retryTimer = setTimeout(() => {
        retryTimer = null
        open()
      }, 1500)
    }
  }

  open()

  return () => {
    closedByApp = true
    if (retryTimer) clearTimeout(retryTimer)
    try { ws?.close() } catch {}
  }
}
