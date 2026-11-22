// Build-time selector only. Never put provider credentials in EXPO_PUBLIC_*.
export const hostedWorkspace = process.env.EXPO_PUBLIC_M8_HOSTED_WORKSPACE === '1'

export interface WorkspaceStatus {
  signedIn: boolean
  passkeys: boolean
  registrationOpen: boolean
  invitationRequired: boolean
  recoveryOnly: boolean
}

export async function workspaceStatus(): Promise<WorkspaceStatus> {
  const response = await fetch('/auth/status', { credentials: 'same-origin' })
  if (!response.ok) throw new Error('Access could not be checked. Try again.')
  return await response.json()
}

export async function workspaceRequest(path: string, body: Record<string, unknown> = {}) {
  if (!['register/options', 'register/verify', 'login/options', 'login/verify', 'logout'].includes(path))
    throw new Error('This access action is unavailable.')
  const response = await fetch('/auth/' + path, {
    method: 'POST', credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result.error || 'Access could not finish. Try again.')
  return result
}
