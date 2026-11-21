export type ToolJsonSchema = {
  type: 'OBJECT'
  properties: Record<string, unknown>
  required?: string[]
}

export type ToolDeclaration = {
  name: string
  description: string
  parameters: ToolJsonSchema
}

export type ToolCall = {
  id?: string
  name?: string
  args?: Record<string, unknown>
}

export type ToolResult = {
  ok: boolean
  response?: string
  message?: string
  error?: string
  [key: string]: unknown
}

export type AppEventPriority = 'low' | 'normal' | 'high' | 'critical'

export type AppEvent = {
  id?: string
  type: 'notification' | 'openclaw_result' | 'status' | 'hello' | 'dispatch_update' | 'wake'
  title?: string
  text?: string
  priority?: AppEventPriority
  source?: 'openclaw' | 'device' | 'bridge'
  payload?: Record<string, unknown>
  createdAt?: number
}

export type ExternalEventHandler = (event: AppEvent) => void

export type SessionState = 'idle' | 'connecting' | 'ready' | 'listening' | 'responding' | 'error' | 'thinking' | 'searching'
