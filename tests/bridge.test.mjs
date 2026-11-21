import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { WebSocket } from 'ws'

test('standalone bridge starts without OpenClaw and rejects unauthenticated API/socket access', { timeout: 20000 }, async t => {
  const child = spawn(process.execPath, ['proxy.mjs'], {
    cwd: new URL('..', import.meta.url), windowsHide: true,
    env: { ...process.env, HOST: '127.0.0.1', PORT: '0', BRIDGE_AUTH_TOKEN: 'test-bridge-fixture', BRIDGE_ACCESS_PASSWORD: '', BRIDGE_SESSION_SECRET: 'test-session-fixture', BRIDGE_ALLOWED_ORIGINS: 'https://example.test', GEMINI_API_KEY: '', GOOGLE_API_KEY: '', OPENCLAW_GATEWAY_TOKEN: '', OPENCLAW_GATEWAY_URL: '', BRIDGE_ENABLE_OPENCLAW_ROUTES: '0', BRIDGE_ENABLE_NOTIFICATION_ROUTES: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  t.after(() => { if (child.exitCode === null) child.kill() })
  const base = await new Promise((resolve, reject) => {
    let output = ''
    const timer = setTimeout(() => reject(new Error('Bridge did not become ready: ' + output.slice(-500))), 12000)
    child.stdout.on('data', chunk => {
      output += chunk
      const match = output.match(/M8 Live proxy on (http:\/\/127\.0\.0\.1:\d+)/)
      if (match) { clearTimeout(timer); resolve(match[1]) }
    })
    child.stderr.on('data', chunk => { output += chunk })
    child.once('exit', code => { clearTimeout(timer); reject(new Error('Bridge exited: ' + code + ' ' + output.slice(-500))) })
  })
  const health = await fetch(base + '/api/health')
  assert.equal(health.status, 200)
  const state = await health.json()
  assert.equal(state.secured, true)
  const denied = await fetch(base + '/api/token')
  assert.equal(denied.status, 401)
  const crossOrigin = await fetch(base + '/api/token', { headers: { Origin: 'https://untrusted.test', Authorization: 'Bearer test-bridge-fixture' } })
  assert.equal(crossOrigin.status, 403)
  const socketStatus = await new Promise((resolve, reject) => {
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/gemini')
    const timer = setTimeout(() => { ws.terminate(); reject(new Error('Upgrade did not return a bounded result')) }, 5000)
    ws.once('unexpected-response', (_request, response) => { clearTimeout(timer); response.resume(); ws.terminate(); resolve(response.statusCode) })
    ws.once('open', () => { ws.close(); reject(new Error('Unauthenticated socket accepted')) })
    ws.on('error', error => { clearTimeout(timer); reject(error) })
  })
  assert.equal(socketStatus, 401)
})
