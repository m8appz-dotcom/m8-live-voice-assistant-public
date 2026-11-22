/** PCM encoding, capture resampling, playback decoding and visual metering. */
export function b64ToArrayBuffer(b64) {
  const bin = globalThis.atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

export function pcm16ToAudioBuffer(ctx, b64, sr = 24000) {
  const dv = new DataView(b64ToArrayBuffer(b64));
  const n = dv.byteLength / 2;
  const ab = ctx.createBuffer(1, n, sr);
  const ch = ab.getChannelData(0);
  for (let i = 0; i < n; i++) ch[i] = dv.getInt16(i * 2, true) / 32768;
  return ab;
}

export function downsample(input, inRate, outRate = 16000) {
  const ratio = inRate / outRate;
  const out = new Int16Array(Math.round(input.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const s = Math.round(i * ratio),
      e = Math.round((i + 1) * ratio);
    let sum = 0,
      cnt = 0;
    for (let j = s; j < e && j < input.length; j++) {
      sum += input[j];
      cnt++;
    }
    const v = cnt ? Math.max(-1, Math.min(1, sum / cnt)) : 0;
    out[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  return out;
}

export function pcm16ToB64(i16) {
  const bytes = new Uint8Array(i16.buffer, i16.byteOffset, i16.byteLength);
  let bin = "";
  for (let i = 0; i < bytes.byteLength; i++)
    bin += String.fromCharCode(bytes[i]);
  return globalThis.btoa(bin);
}

// Concatenate multiple base64 PCM16 chunks into one base64 blob
export function concatPcmB64(chunks) {
  if (chunks.length === 1) return chunks[0];
  const arrays = chunks.map((b64) => {
    const bin = globalThis.atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return arr;
  });
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  let bin = "";
  const chunkSize = 8192;
  for (let i = 0; i < out.length; i += chunkSize) {
    bin += String.fromCharCode(...out.subarray(i, i + chunkSize));
  }
  return globalThis.btoa(bin);
}

// Calculate RMS from base64 PCM16 data for audio reactivity
export function calcPcmRms(b64) {
  try {
    const bin = globalThis.atob(b64);
    const len = bin.length;
    if (len < 4) return 0;
    const sampleCount = len / 2;
    let sumSq = 0;
    // Sample every 8th value for performance
    const step = Math.max(1, Math.floor(sampleCount / 200));
    let counted = 0;
    for (let i = 0; i < sampleCount; i += step) {
      const lo = bin.charCodeAt(i * 2);
      const hi = bin.charCodeAt(i * 2 + 1);
      const sample = (hi << 8) | lo;
      const signed = sample >= 0x8000 ? sample - 0x10000 : sample;
      const norm = signed / 32768;
      sumSq += norm * norm;
      counted++;
    }
    return Math.min(1, Math.sqrt(sumSq / counted) * 3.5); // amplify for visual impact
  } catch {
    return 0;
  }
}
