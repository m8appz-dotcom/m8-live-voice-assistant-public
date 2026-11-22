# A bounded English voice relay

The client needed English speech through existing private inference services. Its server-owned relay connects transcription, streamed model text and streaming speech, keeps provider credentials off the browser and cancels outstanding work when a turn closes or is interrupted.

[Current screens](PRODUCT.md) · [Workspace recording](examples/workspace-walkthrough.mp4) · [Recorded service evidence](examples/voice-acceptance.json)

## Responsibility and decisions

Kenneth Yepez set the direction and constraints: English speech, reuse private inference, prioritize measured latency and preserve active services and data. AI coding agents implemented the relay, migration and checks under his direction.

| Decision demonstrated in the code | Reason and tradeoff |
| --- | --- |
| Start speech on short complete phrases | Avoid waiting for the entire answer; phrase boundaries and cancellation require explicit handling. |
| Propagate the actual PCM rate | Playback must match the service; web, native mobile and Android Auto need separate acceptance. |
| Bound frames, session time, question count and history | Limit resource use and retained state; long conversations need a new session. |
| Keep account tools outside the voice pathway | Constrain the relay to text/audio; account actions require separate enablement. |

## Listen to retained development captures

- [Recorded English test question](examples/recorded-question.wav)
- [Actual ASR → model → speech response](examples/recorded-answer.wav)
- [Actual text → speech response](examples/text-answer.wav)

These originals come from service-identity tests during development on 21 November 2026. The input is authored test audio, not a person's physical microphone recording.

| Observed development sample | Result |
| --- | --- |
| Text question to first received audio | 710 ms |
| Recorded input to first received audio | 717 ms |
| Transcription within that recorded-input sample | 125 ms |
| Speech format | English, mono PCM at 22,050 Hz |

The exact source revision was not recorded with those captures. They are historical observations, not a benchmark of the current revision. One short sample cannot establish latency distributions, physical microphone-to-speaker delay or production capacity.

The workspace video separately records authored text replay and transcript controls. Its label stays visible. Idle waits were shortened; it has no narration and does not depict the service test as a live browser conversation.

## Inspect and reproduce

Read [the private pathway](SPARK-VOICE.md), [server source](../server/spark-voice.mjs), [regressions](../tests/spark-voice.test.mjs) and [native PCM checks](../tests/native/README.md). [Engine setup](../demo/ENGINES.md) requires an operator-configured private relay. No private endpoint or credential is included.

[Integration PR](https://github.com/m8appz-dotcom/m8-live-voice-assistant-public/pull/3) · [Maintenance PR](https://github.com/m8appz-dotcom/m8-live-voice-assistant-public/pull/4). The Expo 58 migration preserves custom native source and recovery. AI reviews remain identified as automated.

## Remaining acceptance

A fresh current-revision benchmark needs verified private routes. Holder passkey registration/login/recovery, physical microphone/playback and native device acceptance remain pending. Tests, the JVM parser check and a web export do not replace those steps. Connected public use needs a stable secure origin. No active inference service, production data or remote configuration changed for this portfolio work.
