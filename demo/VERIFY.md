# Verification and limits

The approved English screen remains the visual baseline. Codex exercised the demo through hidden browser tabs without desktop input. Original images remain unchanged.

## Authored workspace

Verified example selection, text replay controls, transcript export, workspace restore, invalid-file rejection and undo. Replay is separate from a real conversation and does not imply model output.

## Connected voice engine

The demo's server-to-server adapter reaches an isolated, authenticated M8 relay. Its default Spark provider connects existing transcription, streaming LLM and Magpie speech APIs. English Aria speech uses its actual 22,050 Hz sample rate. The browser reuses the repository PCM module and requests a microphone only after an explicit action. No credentials, private endpoints, arbitrary tools or browser-selected model IDs are exposed to the browser.

Real acceptance exercised a machine-authenticated WebSocket question through the demo and relay to the inference services and received PCM speech. A separate recorded English utterance exercised real NeMo transcription followed by streamed text and speech. These are service-identity tests, not a simulated human passkey or physical microphone test. The comparison selected the lower-latency services among those measured; it does not establish a universal latency guarantee. No remote service or production dataset was modified.

Automated regressions cover origin and session gates, challenge replay, invalid credentials, scoped service access, WebSocket protocol filtering, actual audio sample-rate handling, safe upstream failures and native configuration parity. The Expo SDK migration has separate type, compatibility, dependency-audit and web-export checks. See [the engine documentation](../docs/SPARK-VOICE.md).

The browser correctly requires a real passkey before opening a human conversation. Holder registration, sign-in, second-key recovery, physical microphone/audio acceptance and Android/iOS device builds remain pending. No deployment or public inference access is claimed. Machine acceptance does not remove those requirements.
