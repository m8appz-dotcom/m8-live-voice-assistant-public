import type { AppEvent } from '../types/realtime'

type NotificationState = {
  micOn: boolean
  state: string
}

export type NotificationDecision = 'ignore' | 'surface' | 'queue' | 'interrupt'

export function decideNotificationHandling(event: AppEvent, current: NotificationState): NotificationDecision {
  if (event.type !== 'notification') return 'surface'
  const priority = event.priority || 'normal'
  if (priority === 'critical' || priority === 'urgent') return 'interrupt'
  if (current.micOn || current.state === 'listening' || current.state === 'responding') {
    return priority === 'high' ? 'queue' : 'surface'
  }
  return 'surface'
}
