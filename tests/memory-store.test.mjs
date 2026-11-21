import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createMemoryStore } from '../server/memory-store.mjs'

function isolated(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'm8-memory-regression-'))
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()))
    assert.ok(path.basename(root).startsWith('m8-memory-regression-'))
    fs.rmSync(root, { recursive: true, force: true })
  })
  return { root, store: createMemoryStore({ filePath: path.join(root, 'nested', 'memory.json') }) }
}

test('memory persists, normalizes tags, and is searchable after reopening', t => {
  const { root, store } = isolated(t)
  const saved = store.saveMemoryEvent({ text: 'Review the authored voice-assistant example', tags: ' demo, voice,  ', kind: 'task' })
  assert.deepEqual(saved.tags, ['demo', 'voice'])
  const reopened = createMemoryStore({ filePath: path.join(root, 'nested', 'memory.json') })
  assert.equal(reopened.searchMemory('voice')[0].id, saved.id)
  assert.equal(reopened.searchMemory('unrelated').length, 0)
  assert.match(reopened.summarizeMemoryContext().summary, /Review the authored/)
})

test('possible secrets and empty memories are rejected without writing a store', t => {
  const { root, store } = isolated(t)
  assert.throws(() => store.saveMemoryEvent({ text: '  ' }), /text required/)
  assert.throws(() => store.saveMemoryEvent({ text: 'save this password for me' }), /possible secret/)
  assert.equal(fs.existsSync(path.join(root, 'nested', 'memory.json')), false)
})

test('a corrupt store is handled without exposing its contents', t => {
  const { root, store } = isolated(t)
  fs.mkdirSync(path.join(root, 'nested'))
  fs.writeFileSync(path.join(root, 'nested', 'memory.json'), '{invalid')
  assert.deepEqual(store.searchMemory(), [])
  assert.deepEqual(store.summarizeMemoryContext().memories, [])
})
