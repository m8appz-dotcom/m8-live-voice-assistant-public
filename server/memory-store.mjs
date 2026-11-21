import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'

export function createMemoryStore({ filePath }) {
  const MEMORY_STORE_PATH = filePath
  function ensureParentDir(file) { fs.mkdirSync(path.dirname(file), { recursive: true }) }
function loadMemoryStore() {
  try {
    if (!fs.existsSync(MEMORY_STORE_PATH)) return { memories: [] }
    const raw = fs.readFileSync(MEMORY_STORE_PATH, 'utf8').trim()
    if (!raw) return { memories: [] }
    const parsed = JSON.parse(raw)
    return { memories: Array.isArray(parsed.memories) ? parsed.memories : [] }
  } catch {
    return { memories: [] }
  }
}

function saveMemoryStore(store) {
  ensureParentDir(MEMORY_STORE_PATH)
  fs.writeFileSync(MEMORY_STORE_PATH, JSON.stringify({ memories: store.memories.slice(-500) }, null, 2))
}

function normalizeMemoryTags(tags) {
  if (Array.isArray(tags)) return tags.map(tag => String(tag).trim()).filter(Boolean).slice(0, 8)
  return String(tags || '').split(',').map(tag => tag.trim()).filter(Boolean).slice(0, 8)
}

function saveMemoryEvent(input = {}) {
  const text = String(input.text || input.memory || input.note || '').trim()
  if (!text) throw new Error('text required')
  if (/api[_-]?key|token|password|secret|passphrase|private key/i.test(text)) {
    throw new Error('Refusing to save possible secret in memory')
  }
  const store = loadMemoryStore()
  const now = Date.now()
  const memory = {
    id: crypto.randomUUID(),
    text: text.slice(0, 1600),
    kind: String(input.kind || 'note').trim().slice(0, 40) || 'note',
    tags: normalizeMemoryTags(input.tags),
    source: String(input.source || 'm8-live').trim().slice(0, 80) || 'm8-live',
    createdAt: now,
    updatedAt: now,
  }
  store.memories.push(memory)
  saveMemoryStore(store)
  return memory
}

function scoreMemory(query, memory) {
  const q = String(query || '').toLowerCase().split(/\W+/).filter(Boolean)
  if (!q.length) return 1
  const hay = `${memory.text || ''} ${memory.kind || ''} ${(memory.tags || []).join(' ')}`.toLowerCase()
  return q.reduce((score, token) => score + (hay.includes(token) ? 1 : 0), 0)
}

function searchMemory(query = '', limit = 8) {
  const max = Math.max(1, Math.min(20, Number(limit || 8)))
  return [...loadMemoryStore().memories]
    .map(memory => ({ memory, score: scoreMemory(query, memory) }))
    .filter(item => item.score > 0 || !String(query || '').trim())
    .sort((a, b) => b.score - a.score || b.memory.updatedAt - a.memory.updatedAt)
    .slice(0, max)
    .map(item => item.memory)
}

function summarizeMemoryContext(limit = 12) {
  const memories = [...loadMemoryStore().memories]
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, Math.max(1, Math.min(30, Number(limit || 12))))
  return {
    memories,
    summary: memories.map(memory => `- [${memory.kind || 'note'}] ${memory.text}`).join('\n'),
  }
}

  return { saveMemoryEvent, searchMemory, summarizeMemoryContext }
}
