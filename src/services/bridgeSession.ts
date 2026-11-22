export interface BridgeSessionStatus {
  ok: boolean
  authenticated: boolean
  expiresAt: number | null
  openclawRoutes?: boolean
  passkeySupported?: boolean
  passkeyConfigured?: boolean
  passwordConfigured?: boolean
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
  const res = await fetch('/api/bridge/session', {
    method: 'GET',
    credentials: 'same-origin',
  })
  const json = await res.json() as BridgeSessionStatus
  bridgeSessionCache = json
  return json
}

export async function createBridgeSession(password: string): Promise<BridgeSessionStatus> {
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
  await fetch('/api/bridge/session', {
    method: 'DELETE',
    credentials: 'same-origin',
  })
  bridgeSessionCache = null
}
