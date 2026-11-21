import test from 'node:test'
import assert from 'node:assert/strict'
import { b64ToArrayBuffer, downsample, pcm16ToB64, concatPcmB64, calcPcmRms, pcm16ToAudioBuffer } from '../src/audio/pcm.ts'

test('PCM encoding preserves signed samples and respects a typed-array view', () => {
  const storage = new Int16Array([30000, -32768, 0, 32767, 12345])
  const view = storage.subarray(1, 4)
  const decoded = new Int16Array(b64ToArrayBuffer(pcm16ToB64(view)))
  assert.deepEqual([...decoded], [-32768, 0, 32767])
})

test('capture resampling averages each 48kHz frame group and clamps PCM range', () => {
  const samples = new Float32Array([1, 1, 1, -1, -1, -1, 0, 0, 0])
  assert.deepEqual([...downsample(samples, 48000, 16000)], [32767, -32768, 0])
})

test('multiple PCM chunks stay in playback order', () => {
  const chunks = [pcm16ToB64(new Int16Array([1, -2])), pcm16ToB64(new Int16Array([3]))]
  assert.deepEqual([...new Int16Array(b64ToArrayBuffer(concatPcmB64(chunks)))], [1, -2, 3])
  assert.equal(concatPcmB64([chunks[0]]), chunks[0])
})

test('silence and malformed input do not animate the audio meter', () => {
  assert.equal(calcPcmRms(pcm16ToB64(new Int16Array(8))), 0)
  assert.equal(calcPcmRms('not valid base64!'), 0)
  assert.ok(calcPcmRms(pcm16ToB64(new Int16Array([16000, -16000, 16000, -16000]))) > 0)
})

test('playback decoder uses mono little-endian PCM and the supplied rate', () => {
  const floats = new Float32Array(3)
  let call
  const context = { createBuffer: (...args) => { call = args; return { getChannelData: () => floats } } }
  pcm16ToAudioBuffer(context, pcm16ToB64(new Int16Array([-32768, 0, 16384])), 24000)
  assert.deepEqual(call, [1, 3, 24000])
  assert.deepEqual([...floats], [-1, 0, 0.5])
})
