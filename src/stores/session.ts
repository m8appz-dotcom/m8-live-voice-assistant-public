import { create } from 'zustand'

export type AgentState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'tool'

export interface Agent {
  id: string
  name: string
  model: string
  status: string
  lastActivity?: number
}

export interface TranscriptEntry {
  role: 'user' | 'assistant' | 'system'
  text: string
  timestamp: number
}

interface SessionState {
  // Connection
  gatewayUrl: string
  gatewayToken: string
  connected: boolean
  setGateway: (url: string, token: string) => void
  setConnected: (c: boolean) => void

  // Agents
  agents: Agent[]
  setAgents: (a: Agent[]) => void

  // Active session
  activeAgent: Agent | null
  agentState: AgentState
  sessionKey: string | null
  transcript: TranscriptEntry[]
  startSession: (agent: Agent) => void
  endSession: () => void
  setAgentState: (s: AgentState) => void
  addTranscript: (entry: TranscriptEntry) => void

  // Audio
  micActive: boolean
  setMicActive: (m: boolean) => void
}

export const useSessionStore = create<SessionState>((set) => ({
  // Connection
  gatewayUrl: '',
  gatewayToken: '',
  connected: false,
  setGateway: (url, token) => set({ gatewayUrl: url, gatewayToken: token }),
  setConnected: (connected) => set({ connected }),

  // Agents
  agents: [],
  setAgents: (agents) => set({ agents }),

  // Active session
  activeAgent: null,
  agentState: 'idle',
  sessionKey: null,
  transcript: [],
  startSession: (agent) => set({
    activeAgent: agent,
    agentState: 'idle',
    sessionKey: `agent:${agent.id}:live:${Date.now()}`,
    transcript: [],
  }),
  endSession: () => set({
    activeAgent: null,
    agentState: 'idle',
    sessionKey: null,
  }),
  setAgentState: (agentState) => set({ agentState }),
  addTranscript: (entry) => set((state) => ({
    transcript: [...state.transcript, entry],
  })),

  // Audio
  micActive: false,
  setMicActive: (micActive) => set({ micActive }),
}))
