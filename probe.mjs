import pkg from '/home/m8apps/openclaw-live/node_modules/ws/index.js'
const { WebSocket } = pkg

const GATEWAY = 'ws://100.81.153.113:18789'
const TOKEN = process.env.OPENCLAW_GATEWAY_TOKEN || ''
if (!TOKEN) throw new Error('OPENCLAW_GATEWAY_TOKEN missing')

const ORIGIN = 'http://100.121.147.73:18789'
const methods = ['agent.run', 'agent.send', 'sessions.list', 'session.send', 'agent.message', 'run.agent', 'message.send']

for (const method of methods) {
  const result = await new Promise(resolve => {
    const ws = new WebSocket(GATEWAY, { headers: { Origin: ORIGIN } })
    let reqId = 0
    let connectId = null
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
        send(method, { sessionKey: 'm8', message: 'test', agentId: 'm8', text: 'test' })
      }
      if (reqId >= 2 && msg.type === 'res' && msg.id === 'r2') {
        resolve(msg.ok ? 'OK' : 'FAIL: ' + (msg.error && msg.error.message))
        ws.close()
      }
    })
    ws.on('error', e => resolve('WS_ERR: ' + e.message))
    setTimeout(() => { ws.close(); resolve('TIMEOUT') }, 5000)
  })
  console.log(method, '->', result)
}
