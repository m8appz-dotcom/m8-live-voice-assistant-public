#!/usr/bin/env node
import http from 'http'
import readline from 'readline/promises'
import { stdin as input, stdout as output } from 'process'

const PORT = Number(process.env.TELEGRAM_TDLIB_BRIDGE_PORT || 7311)
const HOST = process.env.TELEGRAM_TDLIB_BRIDGE_HOST || '127.0.0.1'
const TOKEN = (process.env.TELEGRAM_TDLIB_BRIDGE_TOKEN || '').trim()
const API_ID = Number(process.env.TELEGRAM_API_ID || 0)
const API_HASH = (process.env.TELEGRAM_API_HASH || '').trim()
const DATABASE_DIRECTORY = process.env.TELEGRAM_TDLIB_DATABASE_DIRECTORY || '.tdlib/telegram-db'
const FILES_DIRECTORY = process.env.TELEGRAM_TDLIB_FILES_DIRECTORY || '.tdlib/telegram-files'

let client = null
let me = null
let startupError = null

function json(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function requireAuth(req, res) {
  if (!TOKEN) return true
  const auth = String(req.headers.authorization || '')
  if (auth === `Bearer ${TOKEN}`) return true
  json(res, 401, { ok: false, error: 'unauthorized' })
  return false
}

function messageText(message) {
  const content = message?.content || {}
  if (content._ === 'messageText') return content.text?.text || ''
  if (content.caption?.text) return content.caption.text
  return content._ || ''
}

function normalizeMessage(message) {
  return {
    id: String(message.id || ''),
    chatId: String(message.chat_id || ''),
    senderId: message.sender_id || null,
    timestamp: Number(message.date || 0) * 1000,
    isOutgoing: Boolean(message.is_outgoing),
    canBeDeletedOnlyForSelf: Boolean(message.can_be_deleted_only_for_self),
    canBeDeletedForAllUsers: Boolean(message.can_be_deleted_for_all_users),
    text: messageText(message),
  }
}

async function invoke(query) {
  if (!client) throw new Error(startupError || 'TDLib client is not ready')
  return client.invoke(query)
}

async function startTdlib() {
  if (!API_ID || !API_HASH) throw new Error('TELEGRAM_API_ID and TELEGRAM_API_HASH are required')
  const [{ default: tdl }, prebuiltTdlib] = await Promise.all([
    import('tdl'),
    import('prebuilt-tdlib'),
  ])
  tdl.configure({ tdjson: prebuiltTdlib.getTdjson() })
  client = tdl.createClient({
    apiId: API_ID,
    apiHash: API_HASH,
    databaseDirectory: DATABASE_DIRECTORY,
    filesDirectory: FILES_DIRECTORY,
  })

  const rl = readline.createInterface({ input, output })
  await client.login(async () => ({
    type: 'user',
    getPhoneNumber: async () => process.env.TELEGRAM_PHONE_NUMBER || await rl.question('Telegram phone number: '),
    getAuthCode: async () => await rl.question('Telegram login code: '),
    getPassword: async () => process.env.TELEGRAM_2FA_PASSWORD || await rl.question('Telegram 2FA password: '),
    getName: async () => ({ firstName: 'M8', lastName: 'Live' }),
  }))
  me = await client.invoke({ _: 'getMe' })
  console.log(`[telegram-tdlib] logged in as ${me.first_name || ''} ${me.last_name || ''} (${me.id})`.trim())
}

async function handle(req, res) {
  if (!requireAuth(req, res)) return
  const url = new URL(req.url || '/', `http://${req.headers.host}`)

  try {
    if (req.method === 'GET' && url.pathname === '/status') {
      return json(res, startupError ? 503 : 200, {
        ok: !startupError && Boolean(client),
        me: me ? { id: String(me.id), firstName: me.first_name || '', lastName: me.last_name || '', username: me.username || '' } : null,
        error: startupError,
      })
    }

    if (req.method === 'GET' && url.pathname === '/search') {
      const q = String(url.searchParams.get('q') || '').trim()
      const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit') || 10)))
      if (!q) return json(res, 400, { ok: false, error: 'q required' })
      const result = await invoke({
        _: 'searchMessages',
        query: q,
        offset_date: 0,
        offset_chat_id: 0,
        offset_message_id: 0,
        limit,
        filter: { _: 'searchMessagesFilterEmpty' },
        min_date: 0,
        max_date: 0,
      })
      return json(res, 200, { ok: true, messages: (result.messages || []).map(normalizeMessage), totalCount: result.total_count || 0 })
    }

    if (req.method === 'GET' && url.pathname === '/thread') {
      const chatId = Number(url.searchParams.get('chatId') || 0)
      const fromMessageId = Number(url.searchParams.get('fromMessageId') || 0)
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 20)))
      if (!chatId) return json(res, 400, { ok: false, error: 'chatId required' })
      const result = await invoke({
        _: 'getChatHistory',
        chat_id: chatId,
        from_message_id: fromMessageId,
        offset: 0,
        limit,
        only_local: false,
      })
      return json(res, 200, { ok: true, chatId: String(chatId), messages: (result.messages || []).map(normalizeMessage) })
    }

    return json(res, 404, { ok: false, error: 'not found' })
  } catch (error) {
    return json(res, 500, { ok: false, error: String(error?.message || error) })
  }
}

startTdlib().catch((error) => {
  startupError = String(error?.message || error)
  console.error(`[telegram-tdlib] startup failed: ${startupError}`)
})

http.createServer(handle).listen(PORT, HOST, () => {
  console.log(`[telegram-tdlib] bridge listening on http://${HOST}:${PORT}`)
})
