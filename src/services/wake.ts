import { getBridgeHeaders, getToolBase } from './appConfig'

export type WakeRecord = {
  id: string
  title?: string
  text: string
  priority?: string
  requiresReply?: boolean
  agent?: string
  dispatchId?: string
  payload?: Record<string, unknown>
  createdAt?: number
  expiresAt?: number
  acknowledgedAt?: number | null
}

export async function fetchWake(wakeId: string, isWeb: boolean) {
  const id = encodeURIComponent(wakeId)
  const res = await fetch(`${getToolBase(isWeb)}/api/wake/${id}`, {
    credentials: isWeb ? 'same-origin' : undefined,
    headers: { ...getBridgeHeaders() },
  })
  const json = await res.json()
  if (!res.ok || !json?.ok) throw new Error(json?.error || `Wake fetch failed (${res.status})`)
  return json.wake as WakeRecord
}

export async function ackWake(wakeId: string, isWeb: boolean) {
  const id = encodeURIComponent(wakeId)
  try {
    await fetch(`${getToolBase(isWeb)}/api/wake/${id}/ack`, {
      method: 'POST',
      credentials: isWeb ? 'same-origin' : undefined,
      headers: { ...getBridgeHeaders() },
    })
  } catch {}
}
