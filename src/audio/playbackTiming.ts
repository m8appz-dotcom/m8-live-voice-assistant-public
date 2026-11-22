/** Allow the entire mono 16-bit PCM batch plus time to load its player. */
export function pcmPlaybackDeadlineMs(byteLength: number, sampleRate: number) {
  if (!Number.isSafeInteger(byteLength) || byteLength < 0 || !Number.isSafeInteger(sampleRate) || sampleRate <= 0)
    throw new RangeError('Invalid PCM timing input')
  return Math.ceil(byteLength / (sampleRate * 2) * 1000) + 20000
}
