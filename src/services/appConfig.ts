import { Platform } from 'react-native'

export const GEMINI_LIVE_MODEL = 'gemini-3.1-flash-live-preview'
export const DEFAULT_GEMINI_VOICE = 'Zephyr'

const FALLBACK_PROXY_URL = 'http://127.0.0.1:7300'

export function getProxyBase(isWeb = Platform.OS === 'web') {
  if (isWeb) return ''
  return (process.env.EXPO_PUBLIC_PROXY_URL || FALLBACK_PROXY_URL).replace(/\/$/, '')
}

export function getToolBase(isWeb = Platform.OS === 'web') {
  return getProxyBase(isWeb)
}

export function toWebSocketUrl(baseUrl: string, pathname: string) {
  const normalizedBase = baseUrl.replace(/\/$/, '')
  const normalizedPath = pathname.startsWith('/') ? pathname : `/${pathname}`
  if (!normalizedBase) return normalizedPath
  return normalizedBase.replace(/^http/, 'ws') + normalizedPath
}

export function getBridgeHeaders(): Record<string, string> {
  // Browser auth is cookie/session based. Do not expose privileged bridge tokens in EXPO_PUBLIC_* bundles.
  return {}
}

export function getDeviceRegistrationHeaders(): Record<string, string> {
  const token = process.env.EXPO_PUBLIC_M8LIVE_DEVICE_REGISTRATION_TOKEN || ''
  return token ? { 'X-M8Live-Device-Token': token } : {}
}

function appendQueryParam(url: string, key: string, value: string) {
  const separator = url.includes('?') ? '&' : '?'
  return `${url}${separator}${encodeURIComponent(key)}=${encodeURIComponent(value)}`
}

export function appendBridgeToken(url: string) {
  // Browser auth is cookie/session based. Native WebSocket requests do not carry that
  // session, so use the scoped device token instead of exposing the privileged bridge token.
  if (Platform.OS === 'web') return url
  const token = process.env.EXPO_PUBLIC_M8LIVE_DEVICE_REGISTRATION_TOKEN || ''
  return token ? appendQueryParam(url, 'device_token', token) : url
}
