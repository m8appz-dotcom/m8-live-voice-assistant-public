import { getBridgeHeaders, getToolBase } from './appConfig'
import type { ToolDeclaration, ToolResult } from '../types/realtime'

export const OPENCLAW_TOOL_DECLARATIONS: ToolDeclaration[] = [
  {
    name: 'openclaw_dispatch',
    description: 'Send a remote execution task to OpenClaw agents on Adrian\'s machine when Gemini needs real machine work beyond native Gemini/device tools. The bridge chooses the safe session and reports progress back for Gemini to speak naturally.',
    parameters: {
      type: 'OBJECT',
      properties: {
        instruction: { type: 'STRING', description: 'Clear task to execute remotely.' },
        target: { type: 'STRING', description: 'Optional target agent: auto, emma, builder, or video_ops.' },
        project: { type: 'STRING', description: 'Optional project or system name.' },
        priority: { type: 'STRING', description: 'Optional priority: normal or high.' },
      },
      required: ['instruction'],
    },
  },
]

const TOOL_ROUTE: Record<string, string> = {
  openclaw_dispatch: '/api/tools/openclaw-dispatch',
}

export function isOpenClawTool(name?: string) {
  return !!name && name in TOOL_ROUTE
}

export async function invokeOpenClawTool(name: string, args: Record<string, unknown>, isWeb: boolean) {
  const toolBase = getToolBase(isWeb)
  const route = TOOL_ROUTE[name]
  if (!route) return { ok: false, error: `Unsupported OpenClaw tool: ${name}` } satisfies ToolResult

  const res = await fetch(`${toolBase}${route}`, {
    method: 'POST',
    credentials: isWeb ? 'same-origin' : undefined,
    headers: {
      'Content-Type': 'application/json',
      ...getBridgeHeaders(),
    },
    body: JSON.stringify(args || {}),
  })

  const json = await res.json()
  return json as ToolResult
}
