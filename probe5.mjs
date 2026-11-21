import pkg from '/home/m8apps/openclaw-live/node_modules/ws/index.js'
const { WebSocket } = pkg
import crypto from 'crypto'

const GATEWAY = 'ws://100.81.153.113:18789'
const TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || ''
if (!TOKEN) throw new Error('OPENCLAW_GATEWAY_TOKEN missing')

const ORIGIN = 'http://100.121.147.73:18789'

const result = await new Promise(resolve => {
  const ws = new WebSocket(GATEWAY, { headers: { Origin: ORIGIN } })
  let reqId = 0
  let connectId = null
  let agentReqId = null
  let runId = null

  const send = (m, p) => {
    const id = 'r' + String(++reqId)
    ws.send(JSON.stringify({ type: 'req', id, method: m, params: p }))
    return id
  }

  ws.on('message', raw => {
    const msg = JSON.parse(raw.toString())

    if (msg.type === 'event' && msg.event === 'connect.challenge') {
      connectId = send('connect', {
        minProtocol: 3, maxProtocol: 3,
        client: { id: 'openclaw-control-ui', version: '1.0.0', platform: 'server', mode: 'ui' },
        role: 'operator', scopes: ['operator.read', 'operator.write', 'operator.admin'],
        caps: [], commands: [], permissions: {}, locale: 'en-US', userAgent: 'probe/1.0',
        auth: { token: TOKEN },
        device: { id: 'probe', publicKey: 'AAAA', signature: 'AAAA', signedAt: Date.now(), nonce: msg.payload && msg.payload.nonce }
      })
    }

    if (msg.type === 'res' && msg.id === connectId) {
      if (!msg.ok) { resolve('AUTH_FAIL: ' + (msg.error && msg.error.message)); ws.close(); return }
      // Try agent method with idempotencyKey
      agentReqId = send('agent', {
        sessionKey: 'm8',
        message: 'Say: pong',
        idempotencyKey: crypto.randomUUID(),
      })
    }

    if (msg.type === 'res' && msg.id === agentReqId) {
      console.log('agent response:', JSON.stringify(msg).substring(0, 300))
      if (msg.ok) {
        runId = msg.payload && msg.payload.runId
        console.log('runId:', runId)
        // Wait for the run to complete
        if (runId) {
          send('agent.wait', { runId, timeoutMs: 30000 })
        } else {
          resolve(JSON.stringify(msg.payload))
          ws.close()
        }
      } else {
        resolve('FAIL: ' + (msg.error && msg.error.message))
        ws.close()
      }
    }

    // agent.wait response or event
    if (msg.type === 'res' && reqId >= 3 && msg.id === 'r' + String(reqId)) {
      console.log('wait result:', JSON.stringify(msg).substring(0, 300))
      resolve(JSON.stringify(msg.payload).substring(0, 300))
      ws.close()
    }

    // Agent events (streaming)
    if (msg.type === 'event' && msg.event === 'agent') {
      const payload = msg.payload
      if (payload && payload.stream === 'text' && payload.data) {
        process.stdout.write(payload.data)
      }
      if (payload && payload.stream === 'lifecycle' && payload.data && payload.data.phase === 'done') {
        console.log('\n[done]')
        resolve('OK: agent done')
        ws.close()
      }
    }
  })

  ws.on('error', e => resolve('WS_ERR: ' + e.message))
  setTimeout(() => { ws.close(); resolve('TIMEOUT') }, 45000)
})

console.log('RESULT:', result)
