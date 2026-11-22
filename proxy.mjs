import {SparkVoiceSession,sparkConfig} from './server/spark-voice.mjs'
import { createMemoryStore } from './server/memory-store.mjs'
import { rejectWebSocketUpgrade } from './server/upgrade-auth.mjs'
import http from 'http'
import fs from 'fs'
import path from 'path'
import crypto from 'crypto'
import { execFile, execSync } from 'child_process'
import { promisify } from 'util'
import { fileURLToPath, pathToFileURL } from 'url'
import { GoogleGenAI } from '@google/genai'
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import { WebSocket, WebSocketServer } from 'ws'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DIST = path.join(__dirname, 'dist')
const ENV_PATH = path.join(__dirname, '.env')
const execFileAsync = promisify(execFile)

if (fs.existsSync(ENV_PATH)) {
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq === -1) continue
    const k = t.slice(0, eq).trim()
    const v = t.slice(eq + 1).trim()
    if (!(k in process.env)) process.env[k] = v
  }
}

const VOICE_PROVIDER = process.env.M8LIVE_PROVIDER || 'spark'
const SPARK_CONFIG = sparkConfig()
const PORT = Number(process.env.PORT || 7300)
const HOST = process.env.HOST || '127.0.0.1'
const GEMINI_API_KEY = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || ''
const GEMINI_LIVE_MODEL = process.env.GEMINI_LIVE_MODEL || 'gemini-3.1-flash-live-preview'
const BRIDGE_AUTH_TOKEN = (process.env.BRIDGE_AUTH_TOKEN || '').trim()
const BRIDGE_ACCESS_PASSWORD = (process.env.BRIDGE_ACCESS_PASSWORD || '').trim()
const BRIDGE_SESSION_SECRET = (process.env.BRIDGE_SESSION_SECRET || BRIDGE_AUTH_TOKEN).trim()
const BRIDGE_SESSION_COOKIE_NAME = process.env.BRIDGE_SESSION_COOKIE_NAME || 'm8live_bridge_session'
const BRIDGE_SESSION_TTL_MS = Math.max(60_000, Number(process.env.BRIDGE_SESSION_TTL_MS || 12 * 60 * 60 * 1000))
const BRIDGE_ALLOWED_ORIGINS = (process.env.BRIDGE_ALLOWED_ORIGINS || 'https://live.m8apps.com,http://localhost:8081,http://localhost:19006,http://localhost:3000')
  .split(',')
  .map(v => v.trim())
  .filter(Boolean)
const BRIDGE_PASSKEY_RP_NAME = process.env.BRIDGE_PASSKEY_RP_NAME || 'M8 Live'
const BRIDGE_PASSKEY_STORE_PATH = process.env.BRIDGE_PASSKEY_STORE_PATH || path.join(__dirname, '.bridge-passkeys.json')
const ENABLE_OPENCLAW_ROUTES = process.env.BRIDGE_ENABLE_OPENCLAW_ROUTES === '1'
const ENABLE_NOTIFICATION_ROUTES = process.env.BRIDGE_ENABLE_NOTIFICATION_ROUTES === '1'
const BRIDGE_ALLOWED_TELEGRAM_TARGET = (process.env.BRIDGE_ALLOWED_TELEGRAM_TARGET || '').trim()
const NOTIFY_TELEGRAM_TARGET = (process.env.BRIDGE_NOTIFY_TELEGRAM_TARGET || '').trim()
const NOTIFY_TELEGRAM_ACCOUNT = (process.env.M8LIVE_NOTIFY_TELEGRAM_ACCOUNT || '').trim()
const HAS_NOTIFICATION_ROUTES = ENABLE_NOTIFICATION_ROUTES || Boolean(NOTIFY_TELEGRAM_TARGET)
const NOTIFY_STATE_PATH = process.env.M8LIVE_NOTIFY_STATE_PATH || path.join(__dirname, '.notify-state.json')
const NOTIFY_MEDIA_DIR = process.env.M8LIVE_NOTIFY_MEDIA_DIR || path.join(__dirname, '.notify-media')
const NOTIFY_MIN_INTERVAL_MS = Math.max(15_000, Number(process.env.M8LIVE_NOTIFY_MIN_INTERVAL_MS || 90_000))
const NOTIFY_DEDUPE_MS = Math.max(60_000, Number(process.env.M8LIVE_NOTIFY_DEDUPE_MS || 10 * 60_000))
const WAKE_STORE_PATH = process.env.M8LIVE_WAKE_STORE_PATH || path.join(__dirname, '.wakes.json')
const DEVICE_STORE_PATH = process.env.M8LIVE_DEVICE_STORE_PATH || path.join(__dirname, '.devices.json')
const DEVICE_REGISTRATION_TOKEN = (process.env.M8LIVE_DEVICE_REGISTRATION_TOKEN || '').trim()
const WAKE_TTL_MS = Math.max(60_000, Number(process.env.M8LIVE_WAKE_TTL_MS || 60 * 60_000))
const M8LIVE_PUBLIC_URL = (process.env.M8LIVE_PUBLIC_URL || 'https://live.m8apps.com/live').replace(/\/$/, '')
const TELEGRAM_TDLIB_BRIDGE_URL = (process.env.M8LIVE_TELEGRAM_TDLIB_BRIDGE_URL || '').trim().replace(/\/$/, '')
const TELEGRAM_TDLIB_BRIDGE_TOKEN = (process.env.M8LIVE_TELEGRAM_TDLIB_BRIDGE_TOKEN || '').trim()
const HAS_TELEGRAM_TDLIB_CONNECTOR = Boolean(TELEGRAM_TDLIB_BRIDGE_URL)
const GMAIL_OAUTH_CLIENT_ID = (process.env.M8LIVE_GMAIL_OAUTH_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim()
const GMAIL_OAUTH_CLIENT_SECRET = (process.env.M8LIVE_GMAIL_OAUTH_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET || '').trim()
const GMAIL_OAUTH_REDIRECT_URI = (process.env.M8LIVE_GMAIL_OAUTH_REDIRECT_URI || '').trim()
const GMAIL_TOKEN_STORE_PATH = process.env.M8LIVE_GMAIL_TOKEN_STORE_PATH || path.join(__dirname, '.gmail-oauth.json')
const GMAIL_ACCESS_TOKEN_COMMAND = (process.env.M8LIVE_GMAIL_ACCESS_TOKEN_COMMAND || '').trim()
const GMAIL_OAUTH_SCOPES = (process.env.M8LIVE_GMAIL_OAUTH_SCOPES || 'https://www.googleapis.com/auth/gmail.readonly')
  .split(/[ ,]+/)
  .map(v => v.trim())
  .filter(Boolean)
const HAS_GMAIL_OAUTH_CONFIG = Boolean(GMAIL_OAUTH_CLIENT_ID && GMAIL_OAUTH_CLIENT_SECRET && GMAIL_OAUTH_REDIRECT_URI)
const HAS_GMAIL_CONNECTOR_CONFIG = HAS_GMAIL_OAUTH_CONFIG || Boolean(GMAIL_ACCESS_TOKEN_COMMAND)
const HAS_REMOTE_DELEGATE_ROUTES = ENABLE_OPENCLAW_ROUTES
const OPENCLAW_GATEWAY_URL = process.env.OPENCLAW_GATEWAY_URL || 'ws://127.0.0.1:18789'
const OPENCLAW_ALLOW_INSECURE_PRIVATE_WS = process.env.OPENCLAW_ALLOW_INSECURE_PRIVATE_WS === '1'
const OPENCLAW_GATEWAY_FALLBACKS = [...new Set([
  OPENCLAW_GATEWAY_URL,
])]
const OPENCLAW_GATEWAY_TOKEN = (process.env.OPENCLAW_GATEWAY_TOKEN || '').trim()
const OPENCLAW_BRIDGE_DEFAULT_SESSION_KEY = process.env.OPENCLAW_BRIDGE_SESSION_KEY || 'agent:main:m8-live-bridge'
const OPENCLAW_BRIDGE_AGENT_ID = process.env.OPENCLAW_BRIDGE_AGENT_ID || 'main'
const OPENCLAW_BRIDGE_MODEL = process.env.OPENCLAW_BRIDGE_MODEL || 'openai-codex/gpt-5.4'
const OPENCLAW_DISPATCH_TIMEOUT_MS = Math.max(30_000, Number(process.env.M8LIVE_OPENCLAW_DISPATCH_TIMEOUT_MS || 120_000))
const OPENCLAW_SEND_RETRIES = Math.max(1, Number(process.env.M8LIVE_OPENCLAW_SEND_RETRIES || 4))
const OPENCLAW_RETRY_BASE_DELAY_MS = Math.max(250, Number(process.env.M8LIVE_OPENCLAW_RETRY_BASE_DELAY_MS || 1_500))
const DISPATCH_STORE_PATH = process.env.M8LIVE_DISPATCH_STORE_PATH || path.join(__dirname, '.dispatches.json')
const MEMORY_STORE_PATH = process.env.M8LIVE_MEMORY_STORE_PATH || path.join(__dirname, '.memory.json')
const DISPATCH_AGENT_CATALOG = [
  {
    id: 'main',
    label: 'Emma',
    runtime: 'main',
    enabled: true,
    defaultSessionMode: 'per_dispatch',
    canNotify: true,
    capabilities: ['orchestration', 'research', 'ops'],
    openclawAgentId: 'main',
    sessionKeyPrefix: 'agent:main:m8-live-bridge',
    model: OPENCLAW_BRIDGE_MODEL,
  },
  {
    id: 'builder',
    label: 'Builder',
    runtime: 'main',
    enabled: true,
    defaultSessionMode: 'per_dispatch',
    canNotify: true,
    capabilities: ['build', 'fix', 'deploy'],
    openclawAgentId: 'builder',
    sessionKeyPrefix: 'agent:builder:m8-live-builder',
    model: OPENCLAW_BRIDGE_MODEL,
  },
  {
    id: 'video-ops',
    label: 'Video Ops',
    runtime: 'main',
    enabled: true,
    defaultSessionMode: 'per_dispatch',
    canNotify: true,
    capabilities: ['video', 'media'],
    openclawAgentId: 'video-ops',
    sessionKeyPrefix: 'agent:video-ops:m8-live-video-ops',
    model: OPENCLAW_BRIDGE_MODEL,
  },
]

function listOpenClawCallModuleCandidates() {
  const candidates = []
  const explicit = process.env.OPENCLAW_CALL_MODULE_PATH
  if (explicit) candidates.push(explicit)

  const candidateBases = [
    process.platform === 'win32' ? path.join(process.env.APPDATA || '', 'npm', 'node_modules') : '',
    process.platform === 'win32' ? path.join(process.env.USERPROFILE || '', 'AppData', 'Roaming', 'npm', 'node_modules') : '',
    '/usr/lib/node_modules',
    '/usr/local/lib/node_modules',
  ].filter(Boolean)

  try {
    const npmRoot = execSync('npm root -g', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
    if (npmRoot) candidateBases.unshift(npmRoot)
  } catch {}

  for (const base of [...new Set(candidateBases)]) {
    const distDir = path.join(base, 'openclaw', 'dist')
    try {
      for (const name of fs.readdirSync(distDir).filter(name => /^call-.*\.js$/.test(name)).sort().reverse()) {
        candidates.push(path.join(distDir, name))
      }
    } catch {}
  }

  return [...new Set(candidates)].filter(candidate => candidate && fs.existsSync(candidate))
}

async function loadOpenClawCallGateway() {
  const errors = []
  for (const candidate of listOpenClawCallModuleCandidates()) {
    try {
      const module = await import(`${pathToFileURL(candidate).href}?v=${Date.now()}`)
      if (typeof module.callGateway === 'function') {
        return { callGateway: module.callGateway, modulePath: candidate }
      }
      errors.push(`${candidate}: callGateway export missing (${Object.keys(module).join(',') || 'no exports'})`)
    } catch (error) {
      errors.push(`${candidate}: ${String(error?.message || error)}`)
    }
  }

  throw new Error(`Unable to locate usable OpenClaw call module. ${errors.join(' | ')}`)
}

if (OPENCLAW_ALLOW_INSECURE_PRIVATE_WS) process.env.OPENCLAW_ALLOW_INSECURE_PRIVATE_WS = '1'
const { callGateway, modulePath: OPENCLAW_CALL_MODULE_PATH } = ENABLE_OPENCLAW_ROUTES
  ? await loadOpenClawCallGateway()
  : { callGateway: async () => { throw new Error('OpenClaw routes are disabled') }, modulePath: null }
const GEMINI_WS_URL = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent?key=${GEMINI_API_KEY}`

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
}

const activeSessions = new Map()
const eventClients = new Set()
const passkeyChallenges = new Map()
const sessionQueues = new Map()

function loadDispatchStore() {
  try {
    if (!fs.existsSync(DISPATCH_STORE_PATH)) return { dispatches: [], events: [] }
    const raw = fs.readFileSync(DISPATCH_STORE_PATH, 'utf8').trim()
    if (!raw) return { dispatches: [], events: [] }
    const parsed = JSON.parse(raw)
    return {
      dispatches: Array.isArray(parsed.dispatches) ? parsed.dispatches : [],
      events: Array.isArray(parsed.events) ? parsed.events : [],
    }
  } catch {
    return { dispatches: [], events: [] }
  }
}

function saveDispatchStore(store) {
  ensureParentDir(DISPATCH_STORE_PATH)
  fs.writeFileSync(DISPATCH_STORE_PATH, JSON.stringify(store, null, 2))
}

const { saveMemoryEvent, searchMemory, summarizeMemoryContext } = createMemoryStore({ filePath: MEMORY_STORE_PATH })

function listDispatches() {
  return loadDispatchStore().dispatches
}

function listDispatchEvents(dispatchId) {
  return loadDispatchStore().events.filter((event) => event.dispatchId === dispatchId)
}

function getDispatchById(dispatchId) {
  return listDispatches().find((dispatch) => dispatch.id === dispatchId) || null
}

function getLatestDispatchByAgent(agentId) {
  const active = ['queued', 'starting', 'running', 'waiting_input', 'blocked']
  return [...listDispatches()]
    .filter((dispatch) => dispatch.agentId === agentId && active.includes(dispatch.status))
    .sort((a, b) => b.updatedAt - a.updatedAt)[0] || null
}

function resolveDispatchAgent(agentId) {
  return DISPATCH_AGENT_CATALOG.find((agent) => agent.id === agentId && agent.enabled) || null
}

function resolveDispatchAgentAlias(input) {
  const value = String(input || '').trim().toLowerCase()
  if (!value) return null
  const aliases = {
    main: ['main', 'emma', 'em'],
    builder: ['builder', 'build'],
    'video-ops': ['video ops', 'video-ops', 'video', 'videoops'],
  }
  for (const [agentId, names] of Object.entries(aliases)) {
    if (names.some((name) => value === name || value.includes(name))) return resolveDispatchAgent(agentId)
  }
  return null
}

function resolveDispatchTarget(body = {}) {
  const explicit = resolveDispatchAgentAlias(body.target || body.agentId || body.agent || '')
  if (explicit) return explicit

  const instruction = String(body.instruction || body.message || '').toLowerCase()
  if (/\b(video|media|clip|render|edit video|thumbnail)\b/.test(instruction)) return resolveDispatchAgent('video-ops')
  if (/\b(code|build|bug|fix|deploy|repo|typescript|tsx|backend|frontend|app)\b/.test(instruction)) return resolveDispatchAgent('builder')
  return resolveDispatchAgent('main')
}

function appendDispatchEvent(dispatchId, event) {
  const store = loadDispatchStore()
  const nextEvent = {
    id: crypto.randomUUID(),
    dispatchId,
    at: Date.now(),
    visibleToUser: true,
    ...event,
  }
  store.events.push(nextEvent)
  const dispatch = store.dispatches.find((item) => item.id === dispatchId)
  if (dispatch) {
    dispatch.updatedAt = nextEvent.at
    if (event.summary) dispatch.latestSummary = event.summary
    if (event.evidence) dispatch.latestEvidence = event.evidence
    if (event.type === 'failed') dispatch.error = event.summary || event.details || 'Dispatch failed'
  }
  saveDispatchStore(store)
  publishEvent({
    type: 'dispatch_update',
    source: 'bridge',
    text: nextEvent.summary,
    payload: { dispatchId, event: nextEvent, dispatch },
  })
  maybeNotifyDispatchUpdate(dispatchId, nextEvent, dispatch)
  return nextEvent
}

function upsertDispatch(dispatch) {
  const store = loadDispatchStore()
  const index = store.dispatches.findIndex((item) => item.id === dispatch.id)
  if (index === -1) store.dispatches.push(dispatch)
  else store.dispatches[index] = dispatch
  saveDispatchStore(store)
  return dispatch
}

function setDispatchStatus(dispatchId, status, patch = {}) {
  const store = loadDispatchStore()
  const dispatch = store.dispatches.find((item) => item.id === dispatchId)
  if (!dispatch) return null
  Object.assign(dispatch, patch)
  dispatch.status = status
  dispatch.updatedAt = Date.now()
  saveDispatchStore(store)
  return dispatch
}

function buildDispatchSessionKey(agent, dispatchId) {
  if (agent.defaultSessionMode === 'reuse' && agent.sessionKey) return agent.sessionKey
  const prefix = agent.sessionKeyPrefix || `agent:${agent.id}:m8-live`
  return `${prefix}:${dispatchId}`
}

function createDispatchRecord({ agent, instruction, project, priority = 'normal', metadata = {} }) {
  const now = Date.now()
  const dispatch = {
    id: `dsp_${crypto.randomUUID()}`,
    createdAt: now,
    updatedAt: now,
    createdBy: 'm8live',
    source: 'm8live',
    agentId: agent.id,
    instruction,
    status: 'queued',
    priority,
    project,
    sessionKey: buildDispatchSessionKey(agent, `pending-${now}`),
    notifyPolicy: {
      onStarted: true,
      onBlocked: true,
      onCompleted: true,
      onFailed: true,
      onProgress: false,
    },
    metadata,
  }
  dispatch.sessionKey = buildDispatchSessionKey(agent, dispatch.id)
  return dispatch
}

function parseDispatchResponse(agent, response) {
  const normalized = String(response || '').trim().toUpperCase()
  let nextStatus = 'completed'
  let eventType = 'completed'
  if (normalized.includes('BLOCKED')) {
    nextStatus = 'blocked'
    eventType = 'blocked'
  } else if (normalized.includes('FAILED')) {
    nextStatus = 'failed'
    eventType = 'failed'
  } else if (normalized.includes('STARTED')) {
    nextStatus = 'running'
    eventType = 'progress'
  }
  return {
    nextStatus,
    eventType,
    summary: String(response || '').trim() || `${agent.label} updated the dispatch`,
  }
}

function buildDispatchInstruction(dispatch, agent, replyText = '') {
  const taskText = String(replyText || dispatch.instruction || '')
  const mentionsTelegram = /\btelegram\b/i.test(taskText)
  const telegramPolicy = mentionsTelegram
    ? (BRIDGE_ALLOWED_TELEGRAM_TARGET
      ? [
          `AUTHORIZED_TELEGRAM_TARGET: ${BRIDGE_ALLOWED_TELEGRAM_TARGET}`,
          '- Telegram delivery is allowed only to AUTHORIZED_TELEGRAM_TARGET above when the user asks to message himself/current user/Boss/Adrian.',
          '- Do not use any Telegram target supplied by the web client, instruction text, usernames, search results, or guesses.',
          '- If the requested recipient is not clearly the authorized current user, block and ask for clarification.',
        ]
      : [
          '- Telegram delivery is not configured for this bridge. Block Telegram send requests and report that BRIDGE_ALLOWED_TELEGRAM_TARGET is missing.',
        ])
    : []

  return [
    `DISPATCH ID: ${dispatch.id}`,
    `AGENT: ${agent.label} (${agent.id})`,
    dispatch.project ? `PROJECT: ${dispatch.project}` : '',
    ...telegramPolicy,
    '',
    replyText ? 'FOLLOW-UP:' : 'TASK:',
    taskText,
    '',
    'RESPONSE CONTRACT:',
    '- Do the requested remote work if you can.',
    '- Keep it concise and concrete.',
    '- Preferred shape: one short summary, then key findings or blocker, then evidence if relevant.',
    '- Reply for Gemini tool consumption. Report status, blockers, completion, and evidence so Gemini can communicate it to the user by voice.',
    '- Do not contact external chats/providers unless explicitly allowed by the policy above for this task.',
  ].filter(Boolean).join('\n')
}

async function runDispatch(dispatch) {
  const agent = resolveDispatchAgent(dispatch.agentId)
  if (!agent) throw new Error(`Unknown agent: ${dispatch.agentId}`)
  const sessionKey = dispatch.sessionKey || buildDispatchSessionKey(agent, dispatch.id)
  const instruction = buildDispatchInstruction(dispatch, agent)

  setDispatchStatus(dispatch.id, 'starting', { sessionKey })
  appendDispatchEvent(dispatch.id, { type: 'created', summary: `Dispatch created for ${agent.label}` })
  appendDispatchEvent(dispatch.id, { type: 'started', summary: `${agent.label} accepted the dispatch` })

  try {
    const result = await sendToAgent(sessionKey, instruction, OPENCLAW_DISPATCH_TIMEOUT_MS, {
      agentId: agent.openclawAgentId || agent.id,
      model: agent.model || OPENCLAW_BRIDGE_MODEL,
    })
    const parsed = parseDispatchResponse(agent, result.response)
    setDispatchStatus(dispatch.id, parsed.nextStatus, { sessionKey, latestSummary: parsed.summary })
    appendDispatchEvent(dispatch.id, { type: parsed.eventType, summary: parsed.summary })
    return { sessionKey, response: parsed.summary, status: parsed.nextStatus }
  } catch (error) {
    const message = String(error?.message || error)
    setDispatchStatus(dispatch.id, 'failed', { sessionKey, error: message, latestSummary: message })
    appendDispatchEvent(dispatch.id, { type: 'failed', summary: message })
    throw error
  }
}

async function replyToDispatch(dispatchId, replyText) {
  const dispatch = getDispatchById(dispatchId)
  if (!dispatch) throw new Error('dispatch not found')
  const agent = resolveDispatchAgent(dispatch.agentId)
  if (!agent) throw new Error(`Unknown agent: ${dispatch.agentId}`)
  const sessionKey = dispatch.sessionKey || buildDispatchSessionKey(agent, dispatch.id)
  const instruction = buildDispatchInstruction(dispatch, agent, replyText)
  appendDispatchEvent(dispatch.id, { type: 'progress', summary: `Reply sent to ${agent.label}` })
  try {
    const result = await sendToAgent(sessionKey, instruction, OPENCLAW_DISPATCH_TIMEOUT_MS, {
      agentId: agent.openclawAgentId || agent.id,
      model: agent.model || OPENCLAW_BRIDGE_MODEL,
    })
    const parsed = parseDispatchResponse(agent, result.response)
    setDispatchStatus(dispatch.id, parsed.nextStatus, { sessionKey, latestSummary: parsed.summary })
    appendDispatchEvent(dispatch.id, { type: parsed.eventType, summary: parsed.summary })
    return { dispatch, response: parsed.summary, status: parsed.nextStatus }
  } catch (error) {
    const message = String(error?.message || error)
    setDispatchStatus(dispatch.id, 'failed', { sessionKey, error: message, latestSummary: message })
    appendDispatchEvent(dispatch.id, { type: 'failed', summary: message })
    throw error
  }
}

function summarizeDispatchStatus(dispatch) {
  const agent = resolveDispatchAgent(dispatch.agentId)
  const label = agent?.label || dispatch.agentId
  return `${label} status: ${dispatch.status}. ${dispatch.latestSummary || 'No summary yet.'}`.trim()
}

function normalizeToolResult({ agent, dispatch, response, status }) {
  const cleanStatus = String(status || dispatch?.status || 'completed')
  const cleanResponse = String(response || dispatch?.latestSummary || '').trim()
  const metadata = dispatch?.metadata && typeof dispatch.metadata === 'object' ? dispatch.metadata : undefined
  return {
    ok: cleanStatus !== 'failed' && cleanStatus !== 'cancelled',
    status: cleanStatus,
    agent: agent.id,
    agentLabel: agent.label,
    dispatchId: dispatch?.id,
    summary: cleanResponse || `${agent.label} finished the remote task.`,
    response: cleanResponse || `${agent.label} finished the remote task.`,
    details: cleanResponse || undefined,
    evidence: dispatch?.latestEvidence || [],
    metadata,
  }
}

async function handleRemoteDelegate(agentId, body = {}) {
  const agent = resolveDispatchAgent(agentId)
  if (!agent) return { ok: false, error: `unknown agent: ${agentId}` }
  const instruction = String(body.instruction || body.message || '').trim()
  if (!instruction) return { ok: false, error: 'instruction required' }

  const dispatch = createDispatchRecord({
    agent,
    instruction,
    project: body.project ? String(body.project).trim() : undefined,
    priority: body.priority === 'high' || body.priority === 'low' ? body.priority : 'normal',
    metadata: {
      source: 'gemini-tool',
      visibleToUser: false,
    },
  })

  upsertDispatch(dispatch)

  const waitForResult = body.waitForResult === true || body.mode === 'sync'
  if (!waitForResult) {
    runDispatch(dispatch).catch(() => {})
    return {
      ok: true,
      status: 'queued',
      agent: agent.id,
      agentLabel: agent.label,
      dispatchId: dispatch.id,
      summary: `${agent.label} accepted the task. I will notify you when it finishes.`,
      response: `${agent.label} accepted the task. I will notify you when it finishes.`,
      metadata: dispatch.metadata,
    }
  }

  try {
    const result = await runDispatch(dispatch)
    return normalizeToolResult({ agent, dispatch: getDispatchById(dispatch.id) || dispatch, response: result.response, status: result.status })
  } catch (error) {
    const message = String(error?.message || error)
    return {
      ok: false,
      status: 'failed',
      agent: agent.id,
      agentLabel: agent.label,
      dispatchId: dispatch.id,
      error: message,
      response: `${agent.label} could not complete the remote task: ${message}`,
      summary: `${agent.label} could not complete the remote task: ${message}`,
    }
  }
}

function ensureParentDir(filePath) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
}

function loadPasskeyStore() {
  try {
    if (!fs.existsSync(BRIDGE_PASSKEY_STORE_PATH)) return { credentials: [] }
    const raw = fs.readFileSync(BRIDGE_PASSKEY_STORE_PATH, 'utf8').trim()
    if (!raw) return { credentials: [] }
    const parsed = JSON.parse(raw)
    return { credentials: Array.isArray(parsed.credentials) ? parsed.credentials : [] }
  } catch {
    return { credentials: [] }
  }
}

function savePasskeyStore(store) {
  ensureParentDir(BRIDGE_PASSKEY_STORE_PATH)
  fs.writeFileSync(BRIDGE_PASSKEY_STORE_PATH, JSON.stringify(store, null, 2))
}

function getStoredPasskeys() {
  return loadPasskeyStore().credentials || []
}

function upsertStoredPasskey(nextCredential) {
  const store = loadPasskeyStore()
  const credentials = (store.credentials || []).filter((credential) => credential.id !== nextCredential.id)
  credentials.push(nextCredential)
  savePasskeyStore({ credentials })
}

function getPasskeyConfigured() {
  return getStoredPasskeys().length > 0
}

function sha256hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex')
}

function base64urlEncode(value) {
  return Buffer.from(value).toString('base64url')
}

function base64urlDecode(value) {
  return Buffer.from(value, 'base64url').toString('utf8')
}

function parseCookies(req) {
  const raw = req.headers.cookie || ''
  const out = {}
  for (const part of raw.split(';')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (!key) continue
    out[key] = value
  }
  return out
}

function getSessionUserAgentHash(req) {
  return sha256hex(String(req.headers['user-agent'] || '')).slice(0, 24)
}

function getPasskeyRpId(req) {
  return (process.env.BRIDGE_PASSKEY_RP_ID || String(req.headers.host || '').split(':')[0] || 'localhost').trim()
}

function getPasskeyOrigin(req) {
  return String(req.headers.origin || BRIDGE_ALLOWED_ORIGINS[0] || '').trim()
}

function getPasskeyChallengeKey(req, type) {
  const cookieValue = parseCookies(req)[BRIDGE_SESSION_COOKIE_NAME]
  const sessionHash = cookieValue ? sha256hex(cookieValue).slice(0, 32) : getSessionUserAgentHash(req)
  return `${type}:${sessionHash}`
}

function setPasskeyChallenge(req, type, challenge) {
  passkeyChallenges.set(getPasskeyChallengeKey(req, type), { challenge, createdAt: Date.now() })
}

function consumePasskeyChallenge(req, type) {
  const key = getPasskeyChallengeKey(req, type)
  const entry = passkeyChallenges.get(key)
  passkeyChallenges.delete(key)
  if (!entry) return ''
  if (Date.now() - entry.createdAt > 5 * 60 * 1000) return ''
  return String(entry.challenge || '')
}

function signSessionPayload(payloadEncoded) {
  if (!BRIDGE_SESSION_SECRET) return ''
  return crypto.createHmac('sha256', BRIDGE_SESSION_SECRET).update(payloadEncoded).digest('base64url')
}

function buildSessionCookieValue(req) {
  const payload = {
    scope: 'bridge',
    exp: Date.now() + BRIDGE_SESSION_TTL_MS,
    ua: getSessionUserAgentHash(req),
  }
  const encoded = base64urlEncode(JSON.stringify(payload))
  return `${encoded}.${signSessionPayload(encoded)}`
}

function readBridgeSession(req) {
  if (!BRIDGE_SESSION_SECRET) return null
  const cookieValue = parseCookies(req)[BRIDGE_SESSION_COOKIE_NAME]
  if (!cookieValue || !cookieValue.includes('.')) return null
  const [payloadEncoded, signature] = cookieValue.split('.')
  if (!payloadEncoded || !signature) return null
  if (signSessionPayload(payloadEncoded) !== signature) return null
  try {
    const payload = JSON.parse(base64urlDecode(payloadEncoded))
    if (!payload || payload.scope !== 'bridge') return null
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null
    if (payload.ua !== getSessionUserAgentHash(req)) return null
    return payload
  } catch {
    return null
  }
}

function buildSetCookie(value, maxAgeSeconds) {
  return `${BRIDGE_SESSION_COOKIE_NAME}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`
}

function clearSessionCookie() {
  return `${BRIDGE_SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT`
}

function isAllowedOrigin(origin) {
  if (!origin) return true
  return BRIDGE_ALLOWED_ORIGINS.includes(origin)
}

function buildCorsHeaders(req) {
  const origin = req.headers.origin
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Vary': 'Origin',
  }
  if (origin && isAllowedOrigin(origin)) headers['Access-Control-Allow-Origin'] = origin
  return headers
}

function sendJson(req, res, status, payload, extraHeaders = {}) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    ...buildCorsHeaders(req),
    ...extraHeaders,
  })
  res.end(JSON.stringify(payload))
}

function getRequestToken(req, url) {
  const auth = req.headers.authorization || ''
  if (auth.startsWith('Bearer ')) return auth.slice('Bearer '.length).trim()
  const headerToken = req.headers['x-bridge-token']
  if (typeof headerToken === 'string' && headerToken.trim()) return headerToken.trim()
  return url.searchParams.get('bridge_token') || ''
}

function hasValidDeviceToken(req, url) {
  if (!DEVICE_REGISTRATION_TOKEN) return false
  const headerToken = req.headers['x-m8live-device-token']
  const requestToken = typeof headerToken === 'string' && headerToken.trim()
    ? headerToken.trim()
    : (url.searchParams.get('device_token') || '').trim()
  return requestToken === DEVICE_REGISTRATION_TOKEN
}

function requireAllowedOrigin(req, res, url) {
  if (!isAllowedOrigin(req.headers.origin)) {
    sendJson(req, res, 403, { ok: false, error: 'origin not allowed' })
    return false
  }
  return true
}

function requireBridgeAuth(req, res, url) {
  if (!requireAllowedOrigin(req, res, url)) return false
  const requestToken = getRequestToken(req, url)
  const hasBridgeToken = Boolean(BRIDGE_AUTH_TOKEN) && requestToken === BRIDGE_AUTH_TOKEN
  const hasBridgeSession = Boolean(readBridgeSession(req))
  const hasDeviceToken = hasValidDeviceToken(req, url)
  if (!hasBridgeToken && !hasBridgeSession && !hasDeviceToken) {
    if (!BRIDGE_AUTH_TOKEN && !BRIDGE_SESSION_SECRET) {
      sendJson(req, res, 503, { ok: false, error: 'bridge auth not configured' })
      return false
    }
    sendJson(req, res, 401, { ok: false, error: 'unauthorized' })
    return false
  }
  return true
}

function requireBridgeSessionSupport(req, res) {
  if (!BRIDGE_ACCESS_PASSWORD || !BRIDGE_SESSION_SECRET) {
    sendJson(req, res, 503, { ok: false, error: 'bridge auth not configured' })
    return false
  }
  return true
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (c) => {
      body += c
      if (body.length > 1024 * 1024) {
        reject(new Error('Too large'))
        req.destroy()
      }
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function publishEvent(event) {
  const payload = JSON.stringify({
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    source: 'bridge',
    ...event,
  })
  for (const client of eventClients) {
    try {
      if (client.readyState === WebSocket.OPEN) client.send(payload)
    } catch {}
  }
}

function loadGmailTokenStore() {
  try {
    if (!fs.existsSync(GMAIL_TOKEN_STORE_PATH)) return {}
    const raw = fs.readFileSync(GMAIL_TOKEN_STORE_PATH, 'utf8').trim()
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveGmailTokenStore(store) {
  ensureParentDir(GMAIL_TOKEN_STORE_PATH)
  fs.writeFileSync(GMAIL_TOKEN_STORE_PATH, JSON.stringify({ ...loadGmailTokenStore(), ...store, updatedAt: Date.now() }, null, 2), { mode: 0o600 })
}

function getGmailStatus() {
  const store = loadGmailTokenStore()
  return {
    ok: HAS_GMAIL_CONNECTOR_CONFIG && Boolean(store.refreshToken || GMAIL_ACCESS_TOKEN_COMMAND),
    source: 'gmail',
    configured: HAS_GMAIL_CONNECTOR_CONFIG,
    connected: Boolean(store.refreshToken || GMAIL_ACCESS_TOKEN_COMMAND),
    authMode: GMAIL_ACCESS_TOKEN_COMMAND ? 'access-token-command' : 'oauth-refresh-token',
    email: store.email || null,
    scopes: GMAIL_OAUTH_SCOPES,
    tokenUpdatedAt: store.updatedAt || null,
    error: HAS_GMAIL_CONNECTOR_CONFIG ? null : 'Gmail OAuth env is not configured',
  }
}

function createGmailAuthStartUrl(req) {
  if (!HAS_GMAIL_OAUTH_CONFIG) return { ...getGmailStatus(), ok: false, error: 'Gmail OAuth client env is not configured; access-token-command mode cannot start OAuth' }
  const state = crypto.randomBytes(18).toString('base64url')
  saveGmailTokenStore({ pendingState: state })
  const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  authUrl.searchParams.set('client_id', GMAIL_OAUTH_CLIENT_ID)
  authUrl.searchParams.set('redirect_uri', GMAIL_OAUTH_REDIRECT_URI)
  authUrl.searchParams.set('response_type', 'code')
  authUrl.searchParams.set('scope', GMAIL_OAUTH_SCOPES.join(' '))
  authUrl.searchParams.set('access_type', 'offline')
  authUrl.searchParams.set('prompt', 'consent')
  authUrl.searchParams.set('state', state)
  return { ok: true, source: 'gmail', authUrl: authUrl.toString(), callback: GMAIL_OAUTH_REDIRECT_URI }
}

async function handleGmailOAuthCallback(url) {
  if (!HAS_GMAIL_OAUTH_CONFIG) return { ...getGmailStatus(), ok: false, error: 'Gmail OAuth client env is not configured' }
  const code = url.searchParams.get('code') || ''
  const state = url.searchParams.get('state') || ''
  const store = loadGmailTokenStore()
  if (!code) return { ok: false, source: 'gmail', error: 'missing code' }
  if (!state || state !== store.pendingState) return { ok: false, source: 'gmail', error: 'invalid state' }
  const token = await exchangeGmailToken({ code, grantType: 'authorization_code' })
  if (!token.ok) return token
  const next = {
    refreshToken: token.refresh_token || store.refreshToken || '',
    accessToken: token.access_token || '',
    expiresAt: Date.now() + Math.max(0, Number(token.expires_in || 0) - 60) * 1000,
    scope: token.scope || GMAIL_OAUTH_SCOPES.join(' '),
    pendingState: null,
  }
  saveGmailTokenStore(next)
  const profile = await gmailApiRequest('https://gmail.googleapis.com/gmail/v1/users/me/profile')
  if (profile.ok && profile.emailAddress) saveGmailTokenStore({ email: profile.emailAddress })
  return { ok: true, source: 'gmail', connected: true, email: profile.emailAddress || null }
}

async function exchangeGmailToken({ code = '', refreshToken = '', grantType }) {
  try {
    const body = new URLSearchParams()
    body.set('client_id', GMAIL_OAUTH_CLIENT_ID)
    body.set('client_secret', GMAIL_OAUTH_CLIENT_SECRET)
    if (grantType === 'authorization_code') {
      body.set('code', code)
      body.set('redirect_uri', GMAIL_OAUTH_REDIRECT_URI)
      body.set('grant_type', 'authorization_code')
    } else {
      body.set('refresh_token', refreshToken)
      body.set('grant_type', 'refresh_token')
    }
    const response = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body })
    const data = await response.json().catch(() => ({}))
    return response.ok ? { ok: true, ...data } : { ok: false, source: 'gmail', status: response.status, error: data.error_description || data.error || 'token exchange failed' }
  } catch (error) {
    return { ok: false, source: 'gmail', error: String(error?.message || error) }
  }
}

async function getGmailAccessToken() {
  if (!HAS_GMAIL_CONNECTOR_CONFIG) return { ok: false, source: 'gmail', error: 'Gmail OAuth env is not configured' }
  if (GMAIL_ACCESS_TOKEN_COMMAND) {
    try {
      const { stdout } = await execFileAsync('/bin/sh', ['-lc', GMAIL_ACCESS_TOKEN_COMMAND], { timeout: 15_000, maxBuffer: 1024 * 1024 })
      const accessToken = String(stdout || '').trim().split(/\s+/)[0]
      if (!accessToken) return { ok: false, source: 'gmail', error: 'access token command returned empty output' }
      return { ok: true, accessToken }
    } catch (error) {
      return { ok: false, source: 'gmail', error: `access token command failed: ${String(error?.message || error)}` }
    }
  }
  const store = loadGmailTokenStore()
  if (!store.refreshToken) return { ok: false, source: 'gmail', error: 'Gmail is not connected', authRequired: true }
  if (store.accessToken && Number(store.expiresAt || 0) > Date.now()) return { ok: true, accessToken: store.accessToken }
  const refreshed = await exchangeGmailToken({ refreshToken: store.refreshToken, grantType: 'refresh_token' })
  if (!refreshed.ok) return refreshed
  saveGmailTokenStore({ accessToken: refreshed.access_token, expiresAt: Date.now() + Math.max(0, Number(refreshed.expires_in || 0) - 60) * 1000 })
  return { ok: true, accessToken: refreshed.access_token }
}

async function gmailApiRequest(url, options = {}) {
  const token = await getGmailAccessToken()
  if (!token.ok) return token
  const response = await fetch(url, { ...options, headers: { Accept: 'application/json', ...(options.headers || {}), Authorization: `Bearer ${token.accessToken}` } })
  const data = await response.json().catch(() => ({}))
  return response.ok ? { ok: true, ...data } : { ok: false, source: 'gmail', status: response.status, error: data.error?.message || data.error || 'gmail api request failed' }
}

function base64UrlDecode(value = '') {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4)
  return Buffer.from(padded, 'base64').toString('utf8')
}

function gmailHeaders(headers = []) {
  const out = {}
  for (const header of headers) out[String(header.name || '').toLowerCase()] = header.value || ''
  return out
}

function collectGmailBody(payload, out = []) {
  if (!payload) return out
  if (payload.body?.data && (payload.mimeType || '').startsWith('text/')) out.push(base64UrlDecode(payload.body.data))
  for (const part of payload.parts || []) collectGmailBody(part, out)
  return out
}

function normalizeGmailMessage(message, includeBody = false) {
  const headers = gmailHeaders(message.payload?.headers || [])
  const bodyParts = includeBody ? collectGmailBody(message.payload) : []
  return {
    id: message.id,
    threadId: message.threadId,
    timestamp: Number(message.internalDate || 0),
    labels: message.labelIds || [],
    from: headers.from || '',
    to: headers.to || '',
    subject: headers.subject || '',
    date: headers.date || '',
    snippet: message.snippet || '',
    body: includeBody ? bodyParts.join('\n\n').trim() : undefined,
  }
}

async function gmailSearchMessages(params = new URLSearchParams()) {
  const q = String(params.get('q') || '').trim()
  const maxResults = Math.min(25, Math.max(1, Number(params.get('limit') || 10)))
  if (!q) return { ok: false, source: 'gmail', error: 'q required' }
  const listUrl = new URL('https://gmail.googleapis.com/gmail/v1/users/me/messages')
  listUrl.searchParams.set('q', q)
  listUrl.searchParams.set('maxResults', String(maxResults))
  const list = await gmailApiRequest(listUrl.toString())
  if (!list.ok) return list
  const messages = []
  for (const item of list.messages || []) {
    const detail = await gmailApiRequest(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(item.id)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject&metadataHeaders=Date`)
    if (detail.ok) messages.push(normalizeGmailMessage(detail, false))
  }
  return { ok: true, source: 'gmail', messages, resultSizeEstimate: list.resultSizeEstimate || messages.length }
}

async function gmailGetMessage(params = new URLSearchParams()) {
  const id = String(params.get('id') || '').trim()
  if (!id) return { ok: false, source: 'gmail', error: 'id required' }
  const detail = await gmailApiRequest(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${encodeURIComponent(id)}?format=full`)
  if (!detail.ok) return detail
  return { ok: true, source: 'gmail', message: normalizeGmailMessage(detail, true) }
}

async function telegramTdlibBridgeRequest(route, params = new URLSearchParams()) {
  if (!HAS_TELEGRAM_TDLIB_CONNECTOR) {
    return {
      ok: false,
      source: 'telegram',
      error: 'Telegram TDLib bridge is not configured',
      setup: 'Set M8LIVE_TELEGRAM_TDLIB_BRIDGE_URL to a local TDLib bridge URL.',
    }
  }

  try {
    const target = new URL(route, `${TELEGRAM_TDLIB_BRIDGE_URL}/`)
    for (const [key, value] of params.entries()) target.searchParams.set(key, value)
    const headers = { Accept: 'application/json' }
    if (TELEGRAM_TDLIB_BRIDGE_TOKEN) headers.Authorization = `Bearer ${TELEGRAM_TDLIB_BRIDGE_TOKEN}`
    const response = await fetch(target, { headers })
    const text = await response.text()
    let body = {}
    try { body = text ? JSON.parse(text) : {} } catch { body = { raw: text } }
    return {
      ok: response.ok && body.ok !== false,
      source: 'telegram',
      status: response.status,
      ...body,
    }
  } catch (error) {
    return { ok: false, source: 'telegram', error: String(error?.message || error) }
  }
}

function loadDeviceStore() {
  try {
    if (!fs.existsSync(DEVICE_STORE_PATH)) return { devices: [] }
    const parsed = JSON.parse(fs.readFileSync(DEVICE_STORE_PATH, 'utf8'))
    return { devices: Array.isArray(parsed.devices) ? parsed.devices : [] }
  } catch {
    return { devices: [] }
  }
}

function saveDeviceStore(store) {
  ensureParentDir(DEVICE_STORE_PATH)
  fs.writeFileSync(DEVICE_STORE_PATH, JSON.stringify(store, null, 2))
}

function upsertDeviceRecord(input = {}) {
  const expoPushToken = String(input.expoPushToken || '').trim()
  if (!expoPushToken || !/^ExponentPushToken\[.+\]$|^ExpoPushToken\[.+\]$/.test(expoPushToken)) throw new Error('valid expoPushToken required')
  const now = Date.now()
  const store = loadDeviceStore()
  const existing = store.devices.find((device) => device.expoPushToken === expoPushToken)
  const record = {
    id: existing?.id || `dev_${crypto.randomUUID()}`,
    expoPushToken,
    platform: String(input.platform || existing?.platform || 'unknown'),
    projectId: input.projectId ? String(input.projectId) : existing?.projectId,
    app: String(input.app || existing?.app || 'm8live'),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    lastWakeAt: existing?.lastWakeAt || null,
    disabledAt: existing?.disabledAt || null,
  }
  store.devices = store.devices.filter((device) => device.expoPushToken !== expoPushToken)
  store.devices.push(record)
  saveDeviceStore(store)
  return record
}

async function sendWakePushToDevices(wake, links) {
  const store = loadDeviceStore()
  const devices = store.devices.filter((device) => device.expoPushToken && !device.disabledAt)
  if (devices.length === 0) return { ok: true, sent: 0, skipped: 'no devices' }
  const messages = devices.map((device) => ({
    to: device.expoPushToken,
    sound: 'default',
    channelId: 'm8live-wake',
    priority: wake.priority === 'high' || wake.priority === 'urgent' ? 'high' : 'default',
    title: wake.title || 'M8 Live',
    body: compactNotificationText(wake.text, 180),
    data: { wakeId: wake.id, url: links.native, webUrl: links.web },
  }))
  const response = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(messages),
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) return { ok: false, sent: 0, error: json?.errors || json }
  const now = Date.now()
  for (const device of devices) device.lastWakeAt = now
  saveDeviceStore(store)
  return { ok: true, sent: devices.length, response: json }
}

function loadWakeStore() {
  try {
    if (!fs.existsSync(WAKE_STORE_PATH)) return { wakes: [] }
    const parsed = JSON.parse(fs.readFileSync(WAKE_STORE_PATH, 'utf8'))
    return { wakes: Array.isArray(parsed.wakes) ? parsed.wakes : [] }
  } catch {
    return { wakes: [] }
  }
}

function saveWakeStore(store) {
  ensureParentDir(WAKE_STORE_PATH)
  fs.writeFileSync(WAKE_STORE_PATH, JSON.stringify(store, null, 2))
}

function pruneWakeStore(store = loadWakeStore()) {
  const now = Date.now()
  store.wakes = store.wakes.filter((wake) => !wake.expiresAt || Number(wake.expiresAt) > now)
  return store
}

function createWakeRecord(input = {}) {
  const now = Date.now()
  const text = String(input.text || input.message || '').trim()
  if (!text) throw new Error('text required')
  const wake = {
    id: `wake_${crypto.randomUUID()}`,
    createdAt: now,
    expiresAt: input.expiresAt ? Number(input.expiresAt) : now + WAKE_TTL_MS,
    title: String(input.title || 'M8 Live').trim(),
    text,
    priority: normalizeNotifyPriority(input.priority),
    requiresReply: input.requiresReply === true,
    agent: input.agent ? String(input.agent) : undefined,
    dispatchId: input.dispatchId ? String(input.dispatchId) : undefined,
    payload: input.payload && typeof input.payload === 'object' ? input.payload : {},
    acknowledgedAt: null,
  }
  const store = pruneWakeStore()
  store.wakes.push(wake)
  saveWakeStore(store)
  return wake
}

function getWakeRecord(wakeId) {
  const store = pruneWakeStore()
  const wake = store.wakes.find((item) => item.id === wakeId) || null
  saveWakeStore(store)
  return wake
}

function ackWakeRecord(wakeId) {
  const store = pruneWakeStore()
  const wake = store.wakes.find((item) => item.id === wakeId) || null
  if (!wake) {
    saveWakeStore(store)
    return null
  }
  wake.acknowledgedAt = Date.now()
  saveWakeStore(store)
  return wake
}

function buildWakeLinks(wakeId) {
  return {
    native: `m8live://live?wakeId=${encodeURIComponent(wakeId)}`,
    web: `${M8LIVE_PUBLIC_URL}?wakeId=${encodeURIComponent(wakeId)}`,
  }
}

function loadNotifyState() {
  try {
    if (!fs.existsSync(NOTIFY_STATE_PATH)) return { lastSentAt: 0, sent: {} }
    const parsed = JSON.parse(fs.readFileSync(NOTIFY_STATE_PATH, 'utf8'))
    return {
      lastSentAt: Number(parsed.lastSentAt || 0),
      sent: parsed.sent && typeof parsed.sent === 'object' ? parsed.sent : {},
    }
  } catch {
    return { lastSentAt: 0, sent: {} }
  }
}

function saveNotifyState(state) {
  ensureParentDir(NOTIFY_STATE_PATH)
  fs.writeFileSync(NOTIFY_STATE_PATH, JSON.stringify(state, null, 2))
}

function normalizeNotifyPriority(priority) {
  const value = String(priority || '').toLowerCase()
  if (['low', 'normal', 'high', 'urgent', 'critical'].includes(value)) return value
  return 'normal'
}

function shouldDeliverNotification({ key, text, priority = 'normal' }) {
  if (!NOTIFY_TELEGRAM_TARGET) return { ok: false, reason: 'no telegram target configured' }
  const state = loadNotifyState()
  const now = Date.now()
  const hash = sha256hex(`${key || ''}\n${text || ''}`).slice(0, 24)
  for (const [sentHash, at] of Object.entries(state.sent)) {
    if (now - Number(at || 0) > NOTIFY_DEDUPE_MS) delete state.sent[sentHash]
  }
  if (state.sent[hash]) {
    saveNotifyState(state)
    return { ok: false, reason: 'duplicate' }
  }
  const normalizedPriority = normalizeNotifyPriority(priority)
  const urgent = normalizedPriority === 'urgent' || normalizedPriority === 'critical' || normalizedPriority === 'high'
  if (!urgent && state.lastSentAt && now - state.lastSentAt < NOTIFY_MIN_INTERVAL_MS) {
    saveNotifyState(state)
    return { ok: false, reason: 'rate_limited' }
  }
  state.lastSentAt = now
  state.sent[hash] = now
  saveNotifyState(state)
  return { ok: true }
}

function compactNotificationText(text, max = 900) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim()
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`
}

async function synthesizeNotificationAudio(text) {
  const clean = compactNotificationText(text, 1200)
  ensureParentDir(path.join(NOTIFY_MEDIA_DIR, 'x'))
  const outPath = path.join(NOTIFY_MEDIA_DIR, `notify-${Date.now()}-${crypto.randomUUID()}.mp3`)

  const elevenKey = (process.env.XI_API_KEY || process.env.ELEVENLABS_API_KEY || '').trim()
  let elevenLabsError = null
  if (elevenKey) {
    try {
      const voiceId = process.env.XI_VOICE_ID || process.env.ELEVENLABS_VOICE_ID || 'EXAVITQu4vr4xnSDxMaL'
      const modelId = process.env.XI_MODEL_ID || process.env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2'
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`, {
        method: 'POST',
        headers: {
          'xi-api-key': elevenKey,
          'content-type': 'application/json',
          accept: 'audio/mpeg',
        },
        body: JSON.stringify({
          text: clean,
          model_id: modelId,
          voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.1, use_speaker_boost: true },
        }),
      })
      if (!response.ok) throw new Error(`ElevenLabs TTS failed: ${response.status}`)
      fs.writeFileSync(outPath, Buffer.from(await response.arrayBuffer()))
      return outPath
    } catch (error) {
      elevenLabsError = error
      console.warn('[notify] ElevenLabs unavailable, trying fallback TTS:', String(error?.message || error))
    }
  }

  const openaiKey = (process.env.OPENAI_API_KEY || '').trim()
  if (openaiKey) {
    const response = await fetch('https://api.openai.com/v1/audio/speech', {
      method: 'POST',
      headers: { authorization: `Bearer ${openaiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts', voice: process.env.OPENAI_TTS_VOICE || 'alloy', input: clean, response_format: 'mp3' }),
    })
    if (!response.ok) throw new Error(`OpenAI TTS failed: ${response.status}`)
    fs.writeFileSync(outPath, Buffer.from(await response.arrayBuffer()))
    return outPath
  }

  throw elevenLabsError || new Error('no TTS provider configured')
}

let notificationVoiceDisabledReason = ''

async function sendTelegramNotification({ text, title = 'OpenClaw', priority = 'normal', voice = true, key = '' }) {
  const message = compactNotificationText(`${title ? `${title}: ` : ''}${text}`, 1200)
  const decision = shouldDeliverNotification({ key, text: message, priority })
  if (!decision.ok) return { ok: true, skipped: decision.reason }

  let mediaPath = null
  if (voice && !notificationVoiceDisabledReason) {
    try {
      mediaPath = await synthesizeNotificationAudio(message)
    } catch (error) {
      notificationVoiceDisabledReason = String(error?.message || error)
      console.warn('[notify] voice synthesis disabled for this process; falling back to text:', notificationVoiceDisabledReason)
    }
  }

  const baseArgs = ['message', 'send', '--channel', 'telegram']
  if (NOTIFY_TELEGRAM_ACCOUNT) baseArgs.push('--account', NOTIFY_TELEGRAM_ACCOUNT)
  baseArgs.push('--target', NOTIFY_TELEGRAM_TARGET, '--message', message, '--json')
  const args = mediaPath ? [...baseArgs, '--media', mediaPath] : baseArgs
  try {
    const result = await execFileAsync('openclaw', args, { timeout: 15_000, maxBuffer: 1024 * 1024 })
    return { ok: true, voice: Boolean(mediaPath), stdout: result.stdout }
  } catch (error) {
    if (!mediaPath) throw error
    const result = await execFileAsync('openclaw', baseArgs, { timeout: 15_000, maxBuffer: 1024 * 1024 })
    return { ok: true, voice: false, fallback: 'text', stdout: result.stdout }
  }
}

function maybeNotifyDispatchUpdate(dispatchId, event, dispatch) {
  const type = String(event?.type || '')
  if (!['completed', 'blocked', 'failed'].includes(type)) return
  if (!dispatch?.notifyPolicy?.[`on${type[0].toUpperCase()}${type.slice(1)}`]) return
  const agent = resolveDispatchAgent(dispatch.agentId)
  const label = agent?.label || dispatch.agentId || 'OpenClaw'
  const statusText = type === 'completed' ? 'terminó' : type === 'blocked' ? 'está bloqueado' : 'falló'
  const priority = type === 'failed' || type === 'blocked' ? 'high' : dispatch.priority || 'normal'
  const summary = compactNotificationText(event.summary || dispatch.latestSummary || 'Sin resumen.', 700)
  sendTelegramNotification({
    title: 'OpenClaw',
    text: `${label} ${statusText}: ${summary}`,
    priority,
    voice: true,
    key: `dispatch:${dispatchId}:${type}:${summary}`,
  }).catch((error) => console.warn('[notify] dispatch notification failed:', String(error?.message || error)))
}

async function createEphemeralToken() {
  if (!GEMINI_API_KEY) throw new Error('GEMINI_API_KEY missing')
  const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY, httpOptions: { apiVersion: 'v1alpha' } })
  const expireTime = new Date(Date.now() + 10 * 60 * 1000).toISOString()
  const newSessionExpireTime = new Date(Date.now() + 5 * 60 * 1000).toISOString()
  const token = await ai.authTokens.create({
    config: {
      uses: 3,
      expireTime,
      newSessionExpireTime,
      liveConnectConstraints: {
        model: `models/${GEMINI_LIVE_MODEL}`,
        config: {
          responseModalities: ['AUDIO'],
        },
      },
    },
  })

  return {
    ok: true,
    token,
    model: GEMINI_LIVE_MODEL,
    apiVersion: 'v1alpha',
    wsUrl: `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${encodeURIComponent(token.name)}`,
  }
}

function extractTextParts(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .filter((part) => part && (part.type === 'text' || typeof part.text === 'string'))
      .map((part) => String(part.text || ''))
      .join('')
  }
  return ''
}

function extractAssistantText(sessionPayload) {
  const messages = sessionPayload?.messages || []
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant')
  return lastAssistant ? extractTextParts(lastAssistant.content) : ''
}

function extractLatestAssistantText(sessionPayload) {
  const messages = sessionPayload?.messages || []
  const assistants = messages.filter((m) => m.role === 'assistant')
  const lastAssistant = assistants[assistants.length - 1]
  return lastAssistant ? extractTextParts(lastAssistant.content) : ''
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function isTransientOpenClawError(error) {
  const message = String(error?.message || error || '')
  return /SESSION_WRITE_LOCK_TIMEOUT|SessionWriteLockTimeoutError|session file locked|OpenClaw session timeout|timeout|ETIMEDOUT|ECONNRESET|EADDRINUSE/i.test(message)
}

async function withSessionQueue(sessionKey, task) {
  const key = String(sessionKey || OPENCLAW_BRIDGE_DEFAULT_SESSION_KEY)
  const previous = sessionQueues.get(key) || Promise.resolve()
  let release
  const current = new Promise((resolve) => { release = resolve })
  const chained = previous.then(() => current, () => current)
  sessionQueues.set(key, chained)
  try {
    await previous.catch(() => {})
    return await task()
  } finally {
    release()
    if (sessionQueues.get(key) === chained) sessionQueues.delete(key)
  }
}

async function callGatewayWithRetry(request, retries = OPENCLAW_SEND_RETRIES) {
  let lastError = null
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      return await callGateway(request)
    } catch (error) {
      lastError = error
      if (!isTransientOpenClawError(error) || attempt === retries) throw error
      await delay(OPENCLAW_RETRY_BASE_DELAY_MS * attempt)
    }
  }
  throw lastError
}

async function ensureBridgeSession(gatewayOpts, sessionKey, agentId = OPENCLAW_BRIDGE_AGENT_ID, model = OPENCLAW_BRIDGE_MODEL) {
  await callGatewayWithRetry({
    ...gatewayOpts,
    method: 'sessions.create',
    params: {
      key: sessionKey,
      agentId,
      label: `M8 Live Bridge (${sessionKey})`,
    },
  })

  await callGatewayWithRetry({
    ...gatewayOpts,
    method: 'sessions.patch',
    params: {
      key: sessionKey,
      model,
    },
  })
}

async function sendToAgent(sessionKey, message, timeoutMs = OPENCLAW_DISPATCH_TIMEOUT_MS, options = {}) {
  if (!OPENCLAW_GATEWAY_TOKEN) throw new Error('OPENCLAW_GATEWAY_TOKEN missing')
  const resolvedSessionKey = String(sessionKey || OPENCLAW_BRIDGE_DEFAULT_SESSION_KEY)

  return withSessionQueue(resolvedSessionKey, async () => {
    let lastError = null

    for (const gatewayUrl of OPENCLAW_GATEWAY_FALLBACKS) {
      for (let attempt = 1; attempt <= OPENCLAW_SEND_RETRIES; attempt += 1) {
        try {
          const perAttemptTimeoutMs = Math.max(timeoutMs, OPENCLAW_DISPATCH_TIMEOUT_MS)
          const gatewayOpts = {
            url: gatewayUrl,
            token: OPENCLAW_GATEWAY_TOKEN,
            clientDisplayName: 'M8 Live Proxy',
            clientVersion: '1.0.0',
            platform: process.platform,
            timeoutMs: perAttemptTimeoutMs,
          }

          await ensureBridgeSession(
            gatewayOpts,
            resolvedSessionKey,
            options.agentId || OPENCLAW_BRIDGE_AGENT_ID,
            options.model || OPENCLAW_BRIDGE_MODEL,
          )

          const beforeSend = await callGatewayWithRetry({
            ...gatewayOpts,
            method: 'sessions.get',
            params: { sessionKey: resolvedSessionKey, limit: 10 },
          })
          const previousAssistantText = extractLatestAssistantText(beforeSend)

          const sendResult = await callGatewayWithRetry({
            ...gatewayOpts,
            method: 'sessions.send',
            params: {
              key: resolvedSessionKey,
              message,
              timeoutMs: perAttemptTimeoutMs,
              idempotencyKey: crypto.randomUUID(),
            },
          })
          const immediateText = extractLatestAssistantText(sendResult) || extractAssistantText(sendResult)
          if (immediateText && immediateText !== previousAssistantText) {
            return { sessionKey: resolvedSessionKey, response: immediateText }
          }

          const startedAt = Date.now()
          while (Date.now() - startedAt < perAttemptTimeoutMs) {
            const sessionData = await callGatewayWithRetry({
              ...gatewayOpts,
              method: 'sessions.get',
              params: { sessionKey: resolvedSessionKey, limit: 10 },
            })
            const latestAssistantText = extractLatestAssistantText(sessionData)
            if (latestAssistantText && latestAssistantText !== previousAssistantText) {
              return { sessionKey: resolvedSessionKey, response: latestAssistantText }
            }
            const messages = sessionData?.messages || []
            const lastMessage = messages[messages.length - 1]
            if (lastMessage?.role === 'assistant' && lastMessage?.stopReason === 'error') {
              throw new Error(lastMessage.errorMessage || 'OpenClaw session failed')
            }
            await delay(1000)
          }

          throw new Error('OpenClaw session timeout')
        } catch (error) {
          lastError = error
          if (!isTransientOpenClawError(error) || attempt === OPENCLAW_SEND_RETRIES) break
          await delay(OPENCLAW_RETRY_BASE_DELAY_MS * attempt)
        }
      }
    }

    throw lastError || new Error('No OpenClaw gateway available')
  })
}

function normalizeSemanticInstruction(rawText) {
  const text = String(rawText || '').trim()
  const lower = text.toLowerCase()

  if (/\b(escriba|escribe|escribirme|escríbeme|escribeme|write to me|message me)\b/.test(lower) && /\btelegram\b/.test(lower)) {
    return 'Send a message to the user on Telegram using the exact allowed chat id when provided.'
  }

  return text
}

function resolveDispatchIntent(rawText) {
  const text = String(rawText || '').trim()
  const lower = text.toLowerCase()
  const replyMatch = lower.match(/^(responde a|reply to)\s+([^,:]+)[: ,]+(.+)$/i)
  if (replyMatch) {
    const agent = resolveDispatchAgentAlias(replyMatch[2])
    if (agent) {
      const active = getLatestDispatchByAgent(agent.id)
      if (active) {
        return {
          intent: 'reply_dispatch',
          agentId: agent.id,
          dispatchId: active.id,
          instruction: text,
          message: replyMatch[3].trim(),
        }
      }
      return {
        intent: 'create_dispatch',
        agentId: agent.id,
        instruction: replyMatch[3].trim(),
      }
    }
  }

  const tellMatch = lower.match(/^(dile a|tell|ask)\s+(emma|builder|video ops|video-ops|videoops|main)\b[: ,]*(.+)$/i)
  if (tellMatch) {
    const agent = resolveDispatchAgentAlias(tellMatch[2])
    if (agent) {
      const tellInstruction = normalizeSemanticInstruction(tellMatch[3].trim())
      return {
        intent: 'create_dispatch',
        agentId: agent.id,
        instruction: tellInstruction,
      }
    }
  }

  const statusMatch = lower.match(/^(status de|estado de|qué hace|que hace|what is|status of)\s+(.+)$/i)
  if (statusMatch) {
    const agent = resolveDispatchAgentAlias(statusMatch[2])
    if (agent) {
      const active = getLatestDispatchByAgent(agent.id)
      return {
        intent: 'status_dispatch',
        agentId: agent.id,
        dispatchId: active?.id,
        instruction: text,
      }
    }
  }

  return {
    intent: 'create_dispatch',
    agentId: 'main',
    instruction: normalizeSemanticInstruction(text),
  }
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`)

    if (req.method === 'OPTIONS') {
      if (!requireAllowedOrigin(req, res, url)) return
      res.writeHead(204, buildCorsHeaders(req))
      return res.end()
    }

    if (req.method === 'GET' && url.pathname === '/api/health') {
      return sendJson(req, res, 200, {
        ok: true,
        provider: VOICE_PROVIDER,
        model: VOICE_PROVIDER === 'spark' ? 'private-voice' : GEMINI_LIVE_MODEL,
        ready: VOICE_PROVIDER === 'spark' ? Boolean(SPARK_CONFIG) : Boolean(GEMINI_API_KEY),
        relay: '/gemini',
        token: VOICE_PROVIDER === 'spark' ? null : '/api/token',
        events: '/events',
        secured: Boolean(BRIDGE_AUTH_TOKEN),
        openclawRoutes: HAS_REMOTE_DELEGATE_ROUTES,
        notificationRoutes: HAS_NOTIFICATION_ROUTES,
        notificationTelegram: Boolean(NOTIFY_TELEGRAM_TARGET),
        telegramTdlibConnector: HAS_TELEGRAM_TDLIB_CONNECTOR,
        gmailConnector: HAS_GMAIL_CONNECTOR_CONFIG && Boolean(loadGmailTokenStore().refreshToken),
        sessionAuth: Boolean(BRIDGE_ACCESS_PASSWORD && BRIDGE_SESSION_SECRET),
        passkeys: getPasskeyConfigured(),
      })
    }

    if (url.pathname === '/api/bridge/session') {
      if (!requireAllowedOrigin(req, res, url)) return

      if (req.method === 'GET') {
        const session = readBridgeSession(req)
        return sendJson(req, res, 200, {
          ok: true,
          authenticated: Boolean(session),
          expiresAt: session?.exp || null,
          openclawRoutes: HAS_REMOTE_DELEGATE_ROUTES,
          passkeySupported: true,
          passkeyConfigured: getPasskeyConfigured(),
          passwordConfigured: Boolean(BRIDGE_ACCESS_PASSWORD),
        })
      }

      if (req.method === 'DELETE') {
        return sendJson(req, res, 200, { ok: true }, { 'Set-Cookie': clearSessionCookie() })
      }

      if (req.method === 'POST') {
        if (!requireBridgeSessionSupport(req, res)) return
        const raw = await readBody(req)
        const body = raw ? JSON.parse(raw) : {}
        const password = String(body.password || '').trim()
        if (!password) return sendJson(req, res, 400, { ok: false, error: 'password required' })
        if (password !== BRIDGE_ACCESS_PASSWORD) return sendJson(req, res, 401, { ok: false, error: 'invalid password' })
        const cookieValue = buildSessionCookieValue(req)
        return sendJson(req, res, 200, {
          ok: true,
          authenticated: true,
          expiresAt: Date.now() + BRIDGE_SESSION_TTL_MS,
          ttlMs: BRIDGE_SESSION_TTL_MS,
          passkeySupported: true,
          passkeyConfigured: getPasskeyConfigured(),
          passwordConfigured: Boolean(BRIDGE_ACCESS_PASSWORD),
        }, { 'Set-Cookie': buildSetCookie(cookieValue, Math.floor(BRIDGE_SESSION_TTL_MS / 1000)) })
      }
    }

    if (url.pathname === '/api/bridge/passkey/register/options') {
      if (!requireBridgeAuth(req, res, url)) return
      if (req.method !== 'POST') return sendJson(req, res, 405, { ok: false, error: 'method not allowed' })
      const options = await generateRegistrationOptions({
        rpName: BRIDGE_PASSKEY_RP_NAME,
        rpID: getPasskeyRpId(req),
        userName: 'm8-live-bridge',
        userDisplayName: 'M8 Live Bridge',
        userID: crypto.randomBytes(32),
        attestationType: 'none',
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'preferred',
        },
        excludeCredentials: getStoredPasskeys().map((credential) => ({
          id: credential.id,
          transports: credential.transports,
        })),
      })
      setPasskeyChallenge(req, 'register', options.challenge)
      return sendJson(req, res, 200, options)
    }

    if (url.pathname === '/api/bridge/passkey/register/verify') {
      if (!requireBridgeAuth(req, res, url)) return
      if (req.method !== 'POST') return sendJson(req, res, 405, { ok: false, error: 'method not allowed' })
      const expectedChallenge = consumePasskeyChallenge(req, 'register')
      if (!expectedChallenge) return sendJson(req, res, 400, { ok: false, error: 'missing registration challenge' })
      const raw = await readBody(req)
      const body = raw ? JSON.parse(raw) : {}
      const verification = await verifyRegistrationResponse({
        response: body,
        expectedChallenge,
        expectedOrigin: getPasskeyOrigin(req),
        expectedRPID: getPasskeyRpId(req),
      })
      if (!verification.verified || !verification.registrationInfo) {
        return sendJson(req, res, 400, { ok: false, error: 'passkey registration failed' })
      }
      const { credential, credentialDeviceType, credentialBackedUp } = verification.registrationInfo
      upsertStoredPasskey({
        id: credential.id,
        publicKey: Buffer.from(credential.publicKey).toString('base64url'),
        counter: credential.counter,
        transports: body.response?.transports || [],
        deviceType: credentialDeviceType,
        backedUp: credentialBackedUp,
        createdAt: Date.now(),
      })
      return sendJson(req, res, 200, { ok: true, configured: true })
    }

    if (url.pathname === '/api/bridge/passkey/authenticate/options') {
      if (!requireAllowedOrigin(req, res, url)) return
      if (req.method !== 'POST') return sendJson(req, res, 405, { ok: false, error: 'method not allowed' })
      const credentials = getStoredPasskeys()
      if (!credentials.length) return sendJson(req, res, 404, { ok: false, error: 'no passkey configured' })
      const options = await generateAuthenticationOptions({
        rpID: getPasskeyRpId(req),
        userVerification: 'preferred',
        allowCredentials: credentials.map((credential) => ({
          id: credential.id,
          transports: credential.transports,
        })),
      })
      setPasskeyChallenge(req, 'authenticate', options.challenge)
      return sendJson(req, res, 200, options)
    }

    if (url.pathname === '/api/bridge/passkey/authenticate/verify') {
      if (!requireAllowedOrigin(req, res, url)) return
      if (req.method !== 'POST') return sendJson(req, res, 405, { ok: false, error: 'method not allowed' })
      const expectedChallenge = consumePasskeyChallenge(req, 'authenticate')
      if (!expectedChallenge) return sendJson(req, res, 400, { ok: false, error: 'missing authentication challenge' })
      const raw = await readBody(req)
      const body = raw ? JSON.parse(raw) : {}
      const storedCredential = getStoredPasskeys().find((credential) => credential.id === body.id)
      if (!storedCredential) return sendJson(req, res, 404, { ok: false, error: 'passkey not recognized' })
      const verification = await verifyAuthenticationResponse({
        response: body,
        expectedChallenge,
        expectedOrigin: getPasskeyOrigin(req),
        expectedRPID: getPasskeyRpId(req),
        credential: {
          id: storedCredential.id,
          publicKey: Buffer.from(storedCredential.publicKey, 'base64url'),
          counter: storedCredential.counter,
          transports: storedCredential.transports,
        },
      })
      if (!verification.verified) return sendJson(req, res, 401, { ok: false, error: 'passkey authentication failed' })
      storedCredential.counter = verification.authenticationInfo.newCounter
      upsertStoredPasskey(storedCredential)
      const cookieValue = buildSessionCookieValue(req)
      return sendJson(req, res, 200, {
        ok: true,
        authenticated: true,
        expiresAt: Date.now() + BRIDGE_SESSION_TTL_MS,
        passkeyConfigured: true,
      }, { 'Set-Cookie': buildSetCookie(cookieValue, Math.floor(BRIDGE_SESSION_TTL_MS / 1000)) })
    }

    const protectedHttpRoutes = [
      '/api/token',
      '/api/dispatch/agents',
      '/api/dispatch/route',
      '/api/dispatches',
      '/api/notify',
      '/api/inject',
      '/api/memory/context',
      '/api/memory/search',
      '/api/memory/event',
      '/api/messages/capabilities',
      '/api/messages/telegram/status',
      '/api/messages/telegram/search',
      '/api/messages/telegram/thread',
      '/api/messages/gmail/status',
      '/api/messages/gmail/auth/start',
      '/api/messages/gmail/search',
      '/api/messages/gmail/message',
      '/api/tools/openclaw-dispatch',
      '/api/tools/delegate-emma',
      '/api/tools/delegate-builder',
      '/api/tools/delegate-video-ops',
    ]

    if (protectedHttpRoutes.includes(url.pathname)) {
      if (!requireBridgeAuth(req, res, url)) return
    }

    if (req.method === 'GET' && url.pathname === '/api/memory/context') {
      const context = summarizeMemoryContext(12)
      return sendJson(req, res, 200, { ok: true, ...context })
    }

    if (req.method === 'POST' && url.pathname === '/api/memory/search') {
      const raw = await readBody(req)
      const body = raw ? JSON.parse(raw) : {}
      const memories = searchMemory(body.query || '', body.limit || 8)
      return sendJson(req, res, 200, { ok: true, memories, summary: memories.map(memory => `- [${memory.kind || 'note'}] ${memory.text}`).join('\n') })
    }

    if (req.method === 'POST' && url.pathname === '/api/memory/event') {
      const raw = await readBody(req)
      const body = raw ? JSON.parse(raw) : {}
      const memory = saveMemoryEvent(body)
      return sendJson(req, res, 200, { ok: true, memory, message: 'Memory saved.' })
    }

    if (req.method === 'GET' && url.pathname === '/api/messages/capabilities') {
      return sendJson(req, res, 200, {
        ok: true,
        sources: {
          telegram: {
            ok: HAS_TELEGRAM_TDLIB_CONNECTOR,
            mode: 'tdlib-bridge',
            fullRead: true,
            configured: HAS_TELEGRAM_TDLIB_CONNECTOR,
            error: HAS_TELEGRAM_TDLIB_CONNECTOR ? null : 'M8LIVE_TELEGRAM_TDLIB_BRIDGE_URL is not configured',
          },
          sms: { ok: true, mode: 'android-local', fullRead: true },
          notifications: { ok: true, mode: 'android-notification-listener', fullRead: false },
          gmail: {
            ok: HAS_GMAIL_CONNECTOR_CONFIG && Boolean(loadGmailTokenStore().refreshToken || GMAIL_ACCESS_TOKEN_COMMAND),
            mode: GMAIL_ACCESS_TOKEN_COMMAND ? 'gmail-api-access-token-command' : 'gmail-api-oauth',
            fullRead: true,
            configured: HAS_GMAIL_CONNECTOR_CONFIG,
            connected: Boolean(loadGmailTokenStore().refreshToken || GMAIL_ACCESS_TOKEN_COMMAND),
            scopes: GMAIL_OAUTH_SCOPES,
            error: HAS_GMAIL_CONNECTOR_CONFIG ? null : 'Gmail OAuth env is not configured',
          },
          whatsappPersonal: { ok: true, mode: 'notifications-assisted-only', fullRead: false },
        },
      })
    }

    if (req.method === 'GET' && url.pathname === '/api/messages/telegram/status') {
      const result = await telegramTdlibBridgeRequest('/status', url.searchParams)
      return sendJson(req, res, result.ok ? 200 : 503, result)
    }

    if (req.method === 'GET' && url.pathname === '/api/messages/telegram/search') {
      const result = await telegramTdlibBridgeRequest('/search', url.searchParams)
      return sendJson(req, res, result.ok ? 200 : 503, result)
    }

    if (req.method === 'GET' && url.pathname === '/api/messages/telegram/thread') {
      const result = await telegramTdlibBridgeRequest('/thread', url.searchParams)
      return sendJson(req, res, result.ok ? 200 : 503, result)
    }

    if (req.method === 'GET' && url.pathname === '/api/messages/gmail/status') {
      return sendJson(req, res, 200, getGmailStatus())
    }

    if (req.method === 'GET' && url.pathname === '/api/messages/gmail/auth/start') {
      const result = createGmailAuthStartUrl(req)
      return sendJson(req, res, result.ok ? 200 : 503, result)
    }

    if (req.method === 'GET' && url.pathname === '/api/messages/gmail/search') {
      const result = await gmailSearchMessages(url.searchParams)
      return sendJson(req, res, result.ok ? 200 : 503, result)
    }

    if (req.method === 'GET' && url.pathname === '/api/messages/gmail/message') {
      const result = await gmailGetMessage(url.searchParams)
      return sendJson(req, res, result.ok ? 200 : 503, result)
    }

    if (req.method === 'GET' && url.pathname === '/api/messages/gmail/oauth/callback') {
      const result = await handleGmailOAuthCallback(url)
      const status = result.ok ? 200 : 400
      return sendJson(req, res, status, result)
    }

    if (req.method === 'POST' && url.pathname === '/api/token') {
      if (VOICE_PROVIDER === 'spark') return sendJson(req, res, 410, {ok:false,error:'Voice access uses your existing sign-in session.'})
      const token = await createEphemeralToken()
      return sendJson(req, res, 200, token)
    }

    if (url.pathname === '/api/tools/openclaw-command' || url.pathname === '/api/tools/openclaw-message' || url.pathname === '/api/openclaw/tool') {
      return sendJson(req, res, 410, { ok: false, error: 'legacy openclaw routes removed; use openclaw_dispatch' })
    }

    const isOpenClawRoute = url.pathname === '/api/dispatch/agents'
      || url.pathname === '/api/dispatches'
      || url.pathname.startsWith('/api/dispatches/')
      || url.pathname === '/api/dispatch/route'
      || url.pathname === '/api/tools/openclaw-dispatch'
      || url.pathname === '/api/tools/delegate-emma'
      || url.pathname === '/api/tools/delegate-builder'
      || url.pathname === '/api/tools/delegate-video-ops'

    if (isOpenClawRoute) {
      if (!HAS_REMOTE_DELEGATE_ROUTES) return sendJson(req, res, 404, { ok: false, error: 'OpenClaw dispatch routes disabled' })
      if (!requireBridgeAuth(req, res, url)) return
    }

    if (req.method === 'GET' && url.pathname === '/api/dispatch/agents') {
      return sendJson(req, res, 200, {
        ok: true,
        agents: DISPATCH_AGENT_CATALOG.map(({ id, label, runtime, enabled, defaultSessionMode, canNotify, capabilities }) => ({
          id,
          label,
          runtime,
          enabled,
          defaultSessionMode,
          canNotify,
          capabilities,
        })),
      })
    }

    if (req.method === 'POST' && url.pathname === '/api/tools/openclaw-dispatch') {
      const raw = await readBody(req)
      const body = raw ? JSON.parse(raw) : {}
      const agent = resolveDispatchTarget(body)
      if (!agent) return sendJson(req, res, 400, { ok: false, error: 'no enabled OpenClaw agent available' })
      const result = await handleRemoteDelegate(agent.id, body)
      return sendJson(req, res, result.ok ? 200 : 400, result)
    }

    if (req.method === 'POST' && url.pathname === '/api/tools/delegate-emma') {
      const raw = await readBody(req)
      const body = raw ? JSON.parse(raw) : {}
      const result = await handleRemoteDelegate('main', body)
      return sendJson(req, res, result.ok ? 200 : 400, result)
    }

    if (req.method === 'POST' && url.pathname === '/api/tools/delegate-builder') {
      const raw = await readBody(req)
      const body = raw ? JSON.parse(raw) : {}
      const result = await handleRemoteDelegate('builder', body)
      return sendJson(req, res, result.ok ? 200 : 400, result)
    }

    if (req.method === 'POST' && url.pathname === '/api/tools/delegate-video-ops') {
      const raw = await readBody(req)
      const body = raw ? JSON.parse(raw) : {}
      const result = await handleRemoteDelegate('video-ops', body)
      return sendJson(req, res, result.ok ? 200 : 400, result)
    }

    if (req.method === 'POST' && url.pathname === '/api/dispatches') {
      const raw = await readBody(req)
      const body = raw ? JSON.parse(raw) : {}
      const agent = resolveDispatchTarget(body)
      const instruction = String(body.instruction || body.message || '').trim()
      if (!agent) return sendJson(req, res, 400, { ok: false, error: 'no enabled OpenClaw agent available' })
      if (!instruction) return sendJson(req, res, 400, { ok: false, error: 'instruction required' })
      const dispatch = createDispatchRecord({
        agent,
        instruction,
        project: body.project ? String(body.project) : undefined,
        priority: body.priority === 'high' || body.priority === 'low' ? body.priority : 'normal',
        metadata: { source: 'api-dispatch' },
      })
      upsertDispatch(dispatch)
      runDispatch(dispatch).catch(() => {})
      return sendJson(req, res, 202, { ok: true, dispatch, intent: 'create_dispatch' })
    }

    if (req.method === 'POST' && url.pathname === '/api/dispatch/route') {
      const raw = await readBody(req)
      const body = raw ? JSON.parse(raw) : {}
      const input = String(body.input || body.message || '').trim()
      if (!input) return sendJson(req, res, 400, { ok: false, error: 'input required' })
      const resolved = resolveDispatchIntent(input)

      if (resolved.intent === 'status_dispatch') {
        if (!resolved.dispatchId) {
          return sendJson(req, res, 200, { ok: true, intent: resolved.intent, summary: 'No active dispatch found for that agent.' })
        }
        const dispatch = getDispatchById(resolved.dispatchId)
        return sendJson(req, res, 200, { ok: true, intent: resolved.intent, dispatch, summary: summarizeDispatchStatus(dispatch) })
      }

      if (resolved.intent === 'reply_dispatch') {
        const result = await replyToDispatch(resolved.dispatchId, resolved.message)
        return sendJson(req, res, 200, {
          ok: true,
          intent: resolved.intent,
          dispatch: getDispatchById(resolved.dispatchId),
          summary: result.response,
        })
      }

      const agent = resolveDispatchAgent(resolved.agentId)
      if (!agent) return sendJson(req, res, 400, { ok: false, error: `unknown agent: ${resolved.agentId}` })
      const dispatch = createDispatchRecord({
        agent,
        instruction: resolved.instruction,
        priority: 'normal',
        metadata: {
          source: 'semantic-route',
          originalInput: input,
        },
      })
      upsertDispatch(dispatch)
      runDispatch(dispatch).catch(() => {})
      return sendJson(req, res, 202, {
        ok: true,
        intent: resolved.intent,
        dispatch,
        summary: `Sent to ${agent.label}.`,
      })
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/dispatches/')) {
      const dispatchId = decodeURIComponent(url.pathname.slice('/api/dispatches/'.length))
      const dispatch = getDispatchById(dispatchId)
      if (!dispatch) return sendJson(req, res, 404, { ok: false, error: 'dispatch not found' })
      return sendJson(req, res, 200, {
        ok: true,
        dispatch,
        events: listDispatchEvents(dispatchId),
      })
    }


    if (req.method === 'POST' && url.pathname === '/api/devices/register') {
      if (DEVICE_REGISTRATION_TOKEN && req.headers['x-m8live-device-token'] !== DEVICE_REGISTRATION_TOKEN) {
        return sendJson(req, res, 401, { ok: false, error: 'invalid device registration token' })
      }
      const raw = await readBody(req)
      const body = raw ? JSON.parse(raw) : {}
      const device = upsertDeviceRecord(body)
      return sendJson(req, res, 200, { ok: true, device })
    }

    if (req.method === 'POST' && url.pathname === '/api/wake') {
      if (!HAS_NOTIFICATION_ROUTES) return sendJson(req, res, 403, { ok: false, error: 'wake routes disabled' })
      if (!requireBridgeAuth(req, res, url)) return
      const raw = await readBody(req)
      const body = raw ? JSON.parse(raw) : {}
      const wake = createWakeRecord(body)
      const links = buildWakeLinks(wake.id)
      const message = `${wake.text}\n\nAbrir M8 Live: ${links.web}\nApp: ${links.native}`
      publishEvent({
        type: 'wake',
        source: 'openclaw',
        title: wake.title,
        text: wake.text,
        priority: wake.priority,
        payload: { wakeId: wake.id, links, wake },
      })
      const [notification, push] = await Promise.all([
        sendTelegramNotification({
          title: wake.title,
          text: message,
          priority: wake.priority,
          voice: false,
          key: `wake:${wake.id}`,
        }),
        sendWakePushToDevices(wake, links).catch((error) => ({ ok: false, sent: 0, error: String(error?.message || error) })),
      ])
      return sendJson(req, res, 201, { ok: true, wake, links, notification, push })
    }

    if (req.method === 'GET' && url.pathname.startsWith('/api/wake/')) {
      const parts = url.pathname.slice('/api/wake/'.length).split('/').filter(Boolean)
      const wakeId = decodeURIComponent(parts[0] || '')
      if (!wakeId) return sendJson(req, res, 400, { ok: false, error: 'wake id required' })
      const wake = getWakeRecord(wakeId)
      if (!wake) return sendJson(req, res, 404, { ok: false, error: 'wake not found or expired' })
      if (parts[1] === 'ack') {
        if (req.method !== 'POST') return sendJson(req, res, 405, { ok: false, error: 'method not allowed' })
      }
      return sendJson(req, res, 200, { ok: true, wake })
    }

    if (req.method === 'POST' && url.pathname.startsWith('/api/wake/') && url.pathname.endsWith('/ack')) {
      const wakeId = decodeURIComponent(url.pathname.slice('/api/wake/'.length, -'/ack'.length).replace(/\/$/, ''))
      const wake = ackWakeRecord(wakeId)
      if (!wake) return sendJson(req, res, 404, { ok: false, error: 'wake not found or expired' })
      return sendJson(req, res, 200, { ok: true, wake })
    }

    if (req.method === 'POST' && url.pathname === '/api/notify') {
      if (!HAS_NOTIFICATION_ROUTES) return sendJson(req, res, 403, { ok: false, error: 'notification routes disabled' })
      const raw = await readBody(req)
      const body = raw ? JSON.parse(raw) : {}
      const text = String(body.text || body.message || '').trim()
      if (!text) return sendJson(req, res, 400, { ok: false, error: 'text required' })
      const priority = normalizeNotifyPriority(body.priority)
      const event = {
        type: 'notification',
        source: 'openclaw',
        priority,
        title: body.title || 'OpenClaw',
        text,
        payload: body.payload || {},
      }
      publishEvent(event)
      const notification = await sendTelegramNotification({
        title: event.title,
        text,
        priority,
        voice: body.voice !== false,
        key: body.key || body.id || `api:${event.title}:${text}`,
      }).catch((error) => ({ ok: false, error: String(error?.message || error) }))
      return sendJson(req, res, 200, { ok: true, delivered: eventClients.size, notification })
    }

    if (req.method === 'POST' && url.pathname === '/api/inject') {
      return sendJson(req, res, 410, { ok: false, error: 'legacy inject route removed' })
    }

    let filePath = path.join(DIST, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname))
    if (filePath !== DIST && !filePath.startsWith(DIST + path.sep)) return sendJson(req, res, 403, { ok: false, error: 'Forbidden' })
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) filePath = path.join(DIST, 'index.html')
    const ext = path.extname(filePath)
    const data = fs.readFileSync(filePath)
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      ...buildCorsHeaders(req),
    })
    res.end(data)
  } catch (e) {
    sendJson(req, res, 500, { ok: false, error: String(e.message || e) })
  }
})

const relayWss = new WebSocketServer({ noServer: true, maxPayload: VOICE_PROVIDER === 'spark' ? 60000 : 1024 * 1024 })
const eventsWss = new WebSocketServer({ noServer: true })

function authorizeWebSocket(req) {
  const url = new URL(req.url || '/', 'http://localhost')
  if (!isAllowedOrigin(req.headers.origin)) return { ok: false, code: 1008, reason: 'origin not allowed' }
  const requestToken = getRequestToken(req, url)
  const hasBridgeToken = Boolean(BRIDGE_AUTH_TOKEN) && requestToken === BRIDGE_AUTH_TOKEN
  const hasBridgeSession = Boolean(readBridgeSession(req))
  const hasDeviceToken = hasValidDeviceToken(req, url)
  if (!hasBridgeToken && !hasBridgeSession && !hasDeviceToken) {
    if (!BRIDGE_AUTH_TOKEN && !BRIDGE_SESSION_SECRET) return { ok: false, code: 1011, reason: 'bridge auth not configured' }
    return { ok: false, code: 1008, reason: 'unauthorized' }
  }
  return { ok: true, url }
}

server.on('upgrade', (req, socket, head) => {
  if (req.url === '/gemini' || req.url?.startsWith('/gemini')) {
    const auth = authorizeWebSocket(req)
    if (!auth.ok) {
      rejectWebSocketUpgrade(socket, auth)
      return
    }

    if (VOICE_PROVIDER === 'spark' && (!SPARK_CONFIG || activeSessions.size >= 2)) { socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\n\r\n'); return }

    relayWss.handleUpgrade(req, socket, head, (clientWs) => {
      const sessionId = crypto.randomUUID()
      const geminiWs = VOICE_PROVIDER === 'spark' ? new SparkVoiceSession(SPARK_CONFIG) : new WebSocket(GEMINI_WS_URL, {
        headers: GEMINI_API_KEY ? { 'X-Goog-Api-Key': GEMINI_API_KEY } : undefined,
      })
      let geminiReady = false
      const clientBuffer = []

      activeSessions.set(sessionId, { geminiWs, clientWs })

      geminiWs.on('open', () => {
        geminiReady = true
        for (const msg of clientBuffer) geminiWs.send(msg)
        clientBuffer.length = 0
      })

      geminiWs.on('message', (data) => {
        const str = typeof data === 'string' ? data : data.toString()
        let isGoAway = false
        try {
          const parsed = JSON.parse(str)
          isGoAway = Boolean(parsed?.goAway)
        } catch {}
        if (clientWs.readyState === WebSocket.OPEN) clientWs.send(str)
        if (isGoAway) {
          setTimeout(() => {
            activeSessions.delete(sessionId)
            if (geminiWs.readyState === WebSocket.OPEN) geminiWs.close(1000, 'goAway acknowledged')
            if (clientWs.readyState === WebSocket.OPEN) clientWs.close(1000, 'Live session expired; reconnecting is required')
          }, 50)
        }
      })

      clientWs.on('message', (data) => {
        const str = typeof data === 'string' ? data : data.toString()
        if (geminiReady && geminiWs.readyState === WebSocket.OPEN) geminiWs.send(str)
        else clientBuffer.push(str)
      })

      geminiWs.on('close', (code, reason) => {
        activeSessions.delete(sessionId)
        if (clientWs.readyState === WebSocket.OPEN) clientWs.close(code, reason?.toString())
      })

      clientWs.on('close', () => {
        activeSessions.delete(sessionId)
        if (geminiWs.readyState === WebSocket.OPEN) geminiWs.close()
      })

      geminiWs.on('error', (e) => console.error('[relay] gemini error:', e.message))
      clientWs.on('error', (e) => console.error('[relay] client error:', e.message))
    })
    return
  }

  if (req.url === '/events' || req.url?.startsWith('/events')) {
    const auth = authorizeWebSocket(req)
    if (!auth.ok) {
      rejectWebSocketUpgrade(socket, auth)
      return
    }

    eventsWss.handleUpgrade(req, socket, head, (clientWs) => {
      eventClients.add(clientWs)
      if (clientWs.readyState === WebSocket.OPEN) {
        clientWs.send(JSON.stringify({ type: 'hello', source: 'bridge', createdAt: Date.now(), text: 'events-ready' }))
        const recentEvents = loadDispatchStore().events
          .filter((event) => event.visibleToUser !== false && Date.now() - Number(event.at || 0) < 30 * 60 * 1000)
          .slice(-20)
        for (const event of recentEvents) {
          const dispatch = getDispatchById(event.dispatchId)
          clientWs.send(JSON.stringify({
            type: 'dispatch_update',
            source: 'bridge-replay',
            text: event.summary,
            payload: { dispatchId: event.dispatchId, event, dispatch, replay: true },
          }))
        }
      }
      clientWs.on('close', () => eventClients.delete(clientWs))
      clientWs.on('error', () => eventClients.delete(clientWs))
    })
    return
  }

  socket.destroy()
})

server.listen(PORT, HOST, () => {
  const address = server.address()
  const actualPort = typeof address === 'object' && address ? address.port : PORT
  console.log(`M8 Live proxy on http://${HOST}:${actualPort}`)
  console.log(`  Voice provider: ${VOICE_PROVIDER}`)
  console.log(`  Auth configured: ${Boolean(BRIDGE_AUTH_TOKEN)}`)
  console.log(`  OpenClaw routes enabled: ${HAS_REMOTE_DELEGATE_ROUTES}`)
  console.log(`  Legacy flag BRIDGE_ENABLE_OPENCLAW_ROUTES: ${ENABLE_OPENCLAW_ROUTES}`)
  console.log(`  Notification routes enabled: ${HAS_NOTIFICATION_ROUTES}`)
  console.log(`  Telegram target configured: ${Boolean(BRIDGE_ALLOWED_TELEGRAM_TARGET)}`)
  console.log(`  Notification Telegram target configured: ${Boolean(NOTIFY_TELEGRAM_TARGET)}`)
  console.log(`  OpenClaw call module: ${OPENCLAW_CALL_MODULE_PATH}`)
})
