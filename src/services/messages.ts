import { getBridgeHeaders, getToolBase } from './appConfig'
import type { ToolDeclaration, ToolResult } from '../types/realtime'

function buildUrl(base: string, path: string, params: Record<string, unknown> = {}) {
  const url = `${base}${path}`
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue
    query.set(key, String(value))
  }
  const qs = query.toString()
  return qs ? `${url}?${qs}` : url
}

async function fetchJson(path: string, params: Record<string, unknown>, isWeb: boolean): Promise<ToolResult> {
  const res = await fetch(buildUrl(getToolBase(isWeb), path, params), {
    method: 'GET',
    headers: getBridgeHeaders(),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok && body?.error) return { ok: false, ...body }
  return body
}

export const MESSAGE_TOOL_DECLARATIONS: ToolDeclaration[] = [
  {
    name: 'message_sources_status',
    description: 'Check which full-read message sources are configured for M8 Live: Telegram TDLib, Gmail/mail, SMS, notifications, and WhatsApp personal limits.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'telegram_message_search',
    description: 'Search Boss\'s Telegram messages through the configured TDLib connector. Use only when Boss explicitly asks to read/search Telegram messages.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'Search text.' },
        limit: { type: 'NUMBER', description: 'Max results, default 10.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'telegram_message_thread',
    description: 'Read recent messages from a Telegram chat/thread through TDLib. Use only after Boss asks for Telegram content or selects a chat.',
    parameters: {
      type: 'OBJECT',
      properties: {
        chatId: { type: 'STRING', description: 'Telegram chat id returned by search/status.' },
        fromMessageId: { type: 'STRING', description: 'Optional message id cursor.' },
        limit: { type: 'NUMBER', description: 'Max messages, default 20.' },
      },
      required: ['chatId'],
    },
  },
  {
    name: 'gmail_auth_status',
    description: 'Check whether Gmail OAuth full-read connector is configured and connected. If not connected, returns auth status only; do not start OAuth unless Boss asks.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'gmail_message_search',
    description: 'Search Boss\'s Gmail messages through Gmail API. Use only when Boss explicitly asks to read/search email.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'Gmail search query, e.g. from:someone newer_than:7d invoice.' },
        limit: { type: 'NUMBER', description: 'Max results, default 10.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'gmail_message_read_full',
    description: 'Read one full Gmail message body by id returned from gmail_message_search. Use only after Boss explicitly asks to read the full email.',
    parameters: {
      type: 'OBJECT',
      properties: {
        id: { type: 'STRING', description: 'Gmail message id.' },
      },
      required: ['id'],
    },
  },
]

export function isMessageTool(name?: string) {
  return !!name && MESSAGE_TOOL_DECLARATIONS.some((tool) => tool.name === name)
}

export async function invokeMessageTool(name: string, args: Record<string, unknown>, isWeb: boolean): Promise<ToolResult> {
  switch (name) {
    case 'message_sources_status':
      return fetchJson('/api/messages/capabilities', {}, isWeb)
    case 'telegram_message_search': {
      const query = String(args?.query || '').trim()
      if (!query) return { ok: false, error: 'query required' }
      return fetchJson('/api/messages/telegram/search', { q: query, limit: args?.limit || 10 }, isWeb)
    }
    case 'telegram_message_thread': {
      const chatId = String(args?.chatId || '').trim()
      if (!chatId) return { ok: false, error: 'chatId required' }
      return fetchJson('/api/messages/telegram/thread', {
        chatId,
        fromMessageId: args?.fromMessageId,
        limit: args?.limit || 20,
      }, isWeb)
    }
    case 'gmail_auth_status':
      return fetchJson('/api/messages/gmail/status', {}, isWeb)
    case 'gmail_message_search': {
      const query = String(args?.query || '').trim()
      if (!query) return { ok: false, error: 'query required' }
      return fetchJson('/api/messages/gmail/search', { q: query, limit: args?.limit || 10 }, isWeb)
    }
    case 'gmail_message_read_full': {
      const id = String(args?.id || '').trim()
      if (!id) return { ok: false, error: 'id required' }
      return fetchJson('/api/messages/gmail/message', { id }, isWeb)
    }
    default:
      return { ok: false, error: `Unsupported message tool: ${name}` }
  }
}
