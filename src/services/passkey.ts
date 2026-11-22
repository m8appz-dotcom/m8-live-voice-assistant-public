import { startAuthentication, startRegistration } from '@simplewebauthn/browser'
import { hostedWorkspace, workspaceRequest } from './hostedWorkspace'

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

export async function registerBridgePasskey(invite = '') {
  if (hostedWorkspace) {
    const options = await workspaceRequest('register/options', { invite })
    const credential = await startRegistration({ optionsJSON: options })
    await workspaceRequest('register/verify', credential as unknown as Record<string, unknown>)
    return { ok: true, configured: true }
  }
  const options = await postJson<any>('/api/bridge/passkey/register/options')
  const attestation = await startRegistration({ optionsJSON: options })
  return await postJson<{ ok: boolean; configured: boolean }>('/api/bridge/passkey/register/verify', attestation as unknown as Record<string, unknown>)
}

export async function authenticateBridgePasskey() {
  if (hostedWorkspace) {
    const options = await workspaceRequest('login/options')
    const credential = await startAuthentication({ optionsJSON: options })
    await workspaceRequest('login/verify', credential as unknown as Record<string, unknown>)
    return { ok: true, authenticated: true, expiresAt: null }
  }
  const options = await postJson<any>('/api/bridge/passkey/authenticate/options')
  const assertion = await startAuthentication({ optionsJSON: options })
  return await postJson<{ ok: boolean; authenticated: boolean; expiresAt: number | null }>('/api/bridge/passkey/authenticate/verify', assertion as unknown as Record<string, unknown>)
}
