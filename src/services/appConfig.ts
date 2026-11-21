import { Platform } from 'react-native'

export const GEMINI_LIVE_MODEL = 'gemini-3.1-flash-live-preview'
export const DEFAULT_GEMINI_VOICE = 'Zephyr'

const FALLBACK_PROXY_URL = ''

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

export function appendBridgeToken(url: string) {
  // Kept for compatibility with existing callers; auth must travel via HttpOnly cookie/session.
  return url
}
