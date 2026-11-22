import { hostedWorkspace, workspaceStatus, workspaceRequest } from './hostedWorkspace'

export interface BridgeSessionStatus {
  ok: boolean
  authenticated: boolean
  expiresAt: number | null
  openclawRoutes?: boolean
  passkeySupported?: boolean
  passkeyConfigured?: boolean
  passwordConfigured?: boolean
  registrationOpen?: boolean
  recoveryOnly?: boolean
}

let bridgeSessionCache: BridgeSessionStatus | null = null

export function getBridgeSession() {
  return bridgeSessionCache
}

export async function getBridgeSessionStatus(isWeb: boolean): Promise<BridgeSessionStatus> {
  if (!isWeb) {
    bridgeSessionCache = { ok: true, authenticated: true, expiresAt: null }
    return bridgeSessionCache
  }
  if (hostedWorkspace) {
    const status = await workspaceStatus()
    bridgeSessionCache = { ok: true, authenticated: status.signedIn === true, expiresAt: null, passkeySupported: status.passkeys === true, passkeyConfigured: true, passwordConfigured: false, registrationOpen: status.registrationOpen, recoveryOnly: status.recoveryOnly, openclawRoutes: false }
    return bridgeSessionCache
  }
  const res = await fetch('/api/bridge/session', {
    method: 'GET',
    credentials: 'same-origin',
  })
  const json = await res.json() as BridgeSessionStatus
  bridgeSessionCache = json
  return json
}

export async function createBridgeSession(password: string): Promise<BridgeSessionStatus> {
  if (hostedWorkspace) throw new Error('Use a passkey to sign in.')
  const res = await fetch('/api/bridge/session', {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  const json = await res.json() as BridgeSessionStatus & { error?: string }
  if (!res.ok) throw new Error(json.error || 'bridge auth failed')
  bridgeSessionCache = json
  return json
}

export async function clearBridgeSession(): Promise<void> {
  if (hostedWorkspace) { await workspaceRequest('logout'); bridgeSessionCache = null; return }
  await fetch('/api/bridge/session', {
    method: 'DELETE',
    credentials: 'same-origin',
  })
  bridgeSessionCache = null
}
