import test from "node:test";
import assert from "node:assert/strict";
import { pcmPlaybackDeadlineMs } from "../src/audio/playbackTiming.ts";

test("native deadline permits complete long batches at both provider rates", () => {
  for (const rate of [22050, 24000]) {
    const bytes = rate * 2 * 35;
    assert.equal(pcmPlaybackDeadlineMs(bytes, rate), 55000);
    assert.ok(pcmPlaybackDeadlineMs(bytes, rate) > 35000);
  }
  assert.equal(pcmPlaybackDeadlineMs(22050, 22050), 20500);
});

test("invalid timing input cannot create a broken playback deadline", () => {
  for (const [bytes, rate] of [
    [-1, 22050],
    [Infinity, 24000],
    [1200, 0],
    [1200, NaN],
  ])
    assert.throws(() => pcmPlaybackDeadlineMs(bytes, rate), RangeError);
});
