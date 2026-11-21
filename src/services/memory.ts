import { getToolBase, getBridgeHeaders, getDeviceRegistrationHeaders } from './appConfig'
import { getItem, setItem } from './storage'
import type { ToolDeclaration, ToolResult } from '../types/realtime'

const LOCAL_MEMORY_KEY = 'm8live.localMemory.v1'

export type LocalMemorySnapshot = {
  updatedAt: number
  recent: Array<{ role: 'user' | 'model'; text: string; at: number }>
}

export const MEMORY_TOOL_DECLARATIONS: ToolDeclaration[] = [
  {
    name: 'memory_search',
    description: 'Search Boss/M8 persistent memory before answering about Boss preferences, prior decisions, active projects, pending tasks, recurring errors, or what happened earlier.',
    parameters: {
      type: 'OBJECT',
      properties: {
        query: { type: 'STRING', description: 'What to recall.' },
        limit: { type: 'NUMBER', description: 'Maximum memory items to return.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'memory_save',
    description: 'Save durable facts, preferences, decisions, tasks, blockers, or repeated errors Boss will expect M8 to remember later. Do not save secrets.',
    parameters: {
      type: 'OBJECT',
      properties: {
        text: { type: 'STRING', description: 'Short memory note to save.' },
        kind: { type: 'STRING', description: 'preference, decision, task, blocker, project, error, or note.' },
        tags: { type: 'STRING', description: 'Optional comma-separated tags.' },
      },
      required: ['text'],
    },
  },
]

export function isMemoryTool(name?: string) {
  return name === 'memory_search' || name === 'memory_save'
}

export async function getLocalMemory(): Promise<LocalMemorySnapshot> {
  try {
    const raw = await getItem(LOCAL_MEMORY_KEY)
    if (!raw) return { updatedAt: 0, recent: [] }
    const parsed = JSON.parse(raw)
    return {
      updatedAt: Number(parsed.updatedAt || 0),
      recent: Array.isArray(parsed.recent) ? parsed.recent.slice(-24) : [],
    }
  } catch {
    return { updatedAt: 0, recent: [] }
  }
}

export async function rememberLocalTurn(role: 'user' | 'model', text: string) {
  const clean = String(text || '').trim()
  if (!clean || /^\[(Tool|Device|Error|M8)\]/i.test(clean)) return
  const current = await getLocalMemory()
  current.recent.push({ role, text: clean.slice(0, 1000), at: Date.now() })
  current.recent = current.recent.slice(-24)
  current.updatedAt = Date.now()
  await setItem(LOCAL_MEMORY_KEY, JSON.stringify(current))
}

export function formatLocalMemory(snapshot: LocalMemorySnapshot) {
  if (!snapshot.recent.length) return ''
  return snapshot.recent
    .slice(-12)
    .map(item => `${item.role === 'user' ? 'Boss' : 'M8'}: ${item.text}`)
    .join('\n')
}

async function bridgeFetch(path: string, body: Record<string, unknown>, isWeb: boolean) {
  const base = getToolBase(isWeb)
  const res = await fetch(`${base}${path}`, {
    method: 'POST',
    credentials: isWeb ? 'same-origin' : undefined,
    headers: {
      'Content-Type': 'application/json',
      ...getBridgeHeaders(),
      ...(!isWeb ? getDeviceRegistrationHeaders() : {}),
    },
    body: JSON.stringify(body),
  })
  return await res.json() as ToolResult
}

export async function fetchMemoryContext(isWeb: boolean) {
  const base = getToolBase(isWeb)
  try {
    const res = await fetch(`${base}/api/memory/context`, {
      method: 'GET',
      credentials: isWeb ? 'same-origin' : undefined,
      headers: {
        ...getBridgeHeaders(),
        ...(!isWeb ? getDeviceRegistrationHeaders() : {}),
      },
    })
    if (!res.ok) return { ok: false, memories: [], summary: '' }
    return await res.json()
  } catch {
    return { ok: false, memories: [], summary: '' }
  }
}

export async function invokeMemoryTool(name: string, args: Record<string, unknown>, isWeb: boolean) {
  if (name === 'memory_search') return bridgeFetch('/api/memory/search', args, isWeb)
  if (name === 'memory_save') return bridgeFetch('/api/memory/event', args, isWeb)
  return { ok: false, error: `Unsupported memory tool: ${name}` } satisfies ToolResult
}
