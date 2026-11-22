# Hosted English voice workspace

Run `node demo/hosted-server.mjs` from the source root with the exact HTTPS `WORKSPACE_ORIGIN`, a dedicated `PORT` and private absolute `WORKSPACE_STATE` outside the release checkout. Install the demo dependency lock first. The entry point binds only to loopback behind its dedicated HTTPS tunnel. It validates the configured Host and Origin and uses that exact hostname as its WebAuthn RP ID; request headers never select an RP ID. Capture is disabled and state is never served statically.

The browser may explore authored examples locally without starting inference. A live conversation requires a verified passkey session. Register a second passkey and keep a browser workspace export for recovery. PINs, biometrics and private authenticator keys never reach this server. The public credential and any workspace explicitly saved by the visitor remain in owner-only private storage. Browser drafts are not an encrypted vault: use public examples and avoid confidential information.

## Direct private transport

Set `M8_DEMO_TRANSPORT=spark` explicitly to reuse the repository's `SparkVoiceSession` directly in the isolated workspace. Configure the private speech/model endpoints described in [SPARK-VOICE.md](../docs/SPARK-VOICE.md) only in the server environment. This removes the additional bridge WebSocket hop without changing those existing inference services. It does not by itself establish a latency improvement; measure the deployed path. No model, voice or provider is selected by a browser request. An invalid explicit transport never silently falls back to another provider.

The existing default `bridge` transport remains available for an intentional rollback. It retains its separate server-to-server bridge identity. Both transports require the same passkey/origin access checks. The existing private machine acceptance identity remains distinct from human authentication and never appears in the browser bundle.

HTTPS origins always enforce one live session at a time, two starts per authenticated principal per hour and six starts globally per hour. `M8_DEMO_PUBLIC=1` also enables these limits for local acceptance. Sessions retain the engine's three-minute duration, twelve-question cap, bounded input/history and request deadlines. Slow-client output buffering is bounded. Closing a conversation aborts its outstanding work. These conservative portfolio quotas can refuse new sessions; they never change model-service configuration or queues.

## State and rollback

Workspace data persists on disk; sessions and challenges expire in memory and clear after restart. This initial release has no automatic deletion or self-service account deletion. Visitors can export local drafts and contact the administrator to remove a saved server workspace. The shared hosted runtime bounds workspace/public-credential/session/challenge capacity and protects existing access when registration capacity is reached. Voice conversations stay in bounded in-memory history rather than a stored recording; separate administrator acceptance recordings contain only an explicitly prepared test question.

Use the dedicated resource-bounded `deploy/portfolio/voice-workspace.service`. Preserve its current release target, private runtime environment and workspace store before an update. Install a new immutable release, verify runtime hashes/tests and atomically switch only this app's current symlink; restart only its unit. Roll back to the recorded target without replacing its workspace store. On first deployment, stop only the new unit and remove only its new public route if needed; preserve private state and original sources. No existing Spark service, model, data store or production configuration is migrated or restarted.


Each admitted account retains a reserved 256 KiB and 6,000 JSON nodes across its five supported private workspace slots; a slot may use at most 192 KiB. Another account cannot consume that reservation. Private registration has 16 finite slots; when full, the administrator must review capacity before admitting more users. Public authored examples remain available without registering. Credential metadata and pre-read store sizes are bounded; invalid/orphaned historical stores are preserved for offline recovery rather than truncated.

## Acceptance

Run `npm run check` in `demo`. Controlled HTTP fixtures test the direct transport, English voice/PCM contract, access rejection and public quotas without contacting a real provider. Existing voice engine tests retain cancellation, timeout and input checks. Separately verify the actual deployed inference path with a private machine identity and retain its exact source revision and artifacts. Such a measurement is a development observation, not a latency guarantee or a physical microphone test.

The holder must complete real registration, sign-in, second-passkey recovery and physical microphone/speaker acceptance at the final secure origin. Keep these checks pending until they occur. Authored example replay must remain visibly distinct from a live response.
