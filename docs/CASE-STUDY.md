# A bounded English voice relay

The application connects English speech through existing private inference services. Its server-owned relay connects transcription, streamed model text and streaming speech, keeps provider credentials off the browser and cancels outstanding work when a turn closes or is interrupted.

[Current screens](PRODUCT.md) · [Earlier authored recording](examples/workspace-walkthrough.mp4) · [Recorded service evidence](examples/voice-acceptance.json)

[Open the HTTPS workspace](https://voice.kennethyepez.com). Live inference requires passkey sign-in and available session capacity; new accounts require an administrator invitation. The original Expo web screen uses the same SparkVoiceSession through the isolated hosted process. Native device acceptance remains separate. The previous authored example and saved-copy interface is retained at `/workspace/`. [Deployment and recovery](../demo/HOSTING.md) describe private storage and finite account capacity.

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

The original Expo screen is published through a hosted export, preserving its spectrum and native visual sources. On 22 November 2026, the holder signed in at the same public origin with the existing passkey and confirmed English microphone recognition and audible playback. The browser showed the controlled transcript and real model reply; a separate typed turn also returned through the engine. Settings navigation retained that conversation. Desktop and 390px browser views were inspected, and microphone capture was stopped afterward. The existing account/credential/workspace file remained byte-for-byte unchanged during cutover.

Second-authenticator enrollment/recovery and native device acceptance remain incomplete. The holder's brief recognition/playback check does not establish general acoustic quality or a current-release latency benchmark. Tests, the JVM parser check and a web export do not replace those remaining checks. Only the isolated voice workspace was updated; other Spark services and private inference configuration were preserved.
