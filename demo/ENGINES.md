# Repository engine connection

**Live conversation**

Uses a private server-to-server voice relay backed by the actual repository Spark voice engine. It streams the LLM answer into English Aria speech and accepts PCM microphone input through NeMo ASR. The repository PCM functions handle capture and playback at the actual announced sample rate. Authored text replay remains separate.

## Setup

Install the repository root dependencies under Node 24.x or 26.x, configure the server-only private inference connections described in [SPARK-VOICE.md](../docs/SPARK-VOICE.md), and run the bridge in its isolated state directory. Configure M8_DEMO_BRIDGE_URL, M8_DEMO_BRIDGE_TOKEN and M8_DEMO_BRIDGE_ORIGIN only in the demo server environment. Remote bridges require wss; authenticated loopback forwarding may use ws. The compatibility path is /gemini, without URL credentials or query parameters.

The browser signs in with a real passkey before a live conversation. It receives neither the bridge token nor a provider key. Microphone access is requested only after its button is pressed. No external account tools are enabled. This demo does not start or change a remote service.

The actual private relay completed a text-to-voice request and the engine recognized a recorded English question before returning streamed speech. Physical holder passkey/microphone acceptance remains pending; a machine service identity and a recorded utterance are not substitutes. The original authored replay is not presented as a live model response.

## Access and outputs

The existing FIDO2/WebAuthn workspace flow remains in place. Real holder registration, sign-in and second-key recovery still require holder interaction. Live provider actions require a verified session. There is no demo authentication bypass.

Machine-only acceptance can use an explicitly configured DEMO_SERVICE_TOKEN of at least 32 random bytes. Keep it in a private server environment and never in browser code or URLs. It represents a service identity, not a human passkey test. No token is included in this repository.

Each engine task writes only beneath its own ignored `.demo-state/engine/<run>` directory. Download links require the same browser ownership cookie (or the configured service identity). Jobs expire after one hour in memory; disk files are retained locally for recovery and are not automatically deleted. No production database or existing service is changed. Stop this local demo normally when finished.

The gateway rejects foreign origins, unknown actions, oversized input, cross-session artifact access and outputs outside the job directory. Raw provider errors stay in private run logs. It never accepts an arbitrary remote URL or a filesystem path from the browser.

## Acceptance

The adapter is exercised separately from its browser journey; see VERIFY.md. `npm test` includes origin, access, job ownership and error-isolation checks. Physical passkey and live-provider limits are stated explicitly. Preserve `.demo-state` before removing or replacing this isolated demo if its outputs matter.
