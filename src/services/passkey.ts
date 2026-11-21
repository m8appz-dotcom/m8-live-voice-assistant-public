import { startAuthentication, startRegistration } from '@simplewebauthn/browser'

export interface PasskeyStatus {
  supported: boolean
  configured: boolean
}

export function isPasskeySupported() {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential !== 'undefined'
}

async function postJson<T>(url: string, body?: Record<string, unknown>) {
  const res = await fetch(url, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json.error || 'request failed')
  return json as T
}

export async function registerBridgePasskey() {
  const options = await postJson<any>('/api/bridge/passkey/register/options')
  const attestation = await startRegistration({ optionsJSON: options })
  return await postJson<{ ok: boolean; configured: boolean }>('/api/bridge/passkey/register/verify', attestation as unknown as Record<string, unknown>)
}

export async function authenticateBridgePasskey() {
  const options = await postJson<any>('/api/bridge/passkey/authenticate/options')
  const assertion = await startAuthentication({ optionsJSON: options })
  return await postJson<{ ok: boolean; authenticated: boolean; expiresAt: number | null }>('/api/bridge/passkey/authenticate/verify', assertion as unknown as Record<string, unknown>)
}
