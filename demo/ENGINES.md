# Repository engine connection

**Live conversation**

Adds a private server-to-server WebSocket adapter for an existing M8 `/gemini` bridge. It preserves gemini-3.1-flash-live-preview and Zephyr, fixes English instructions, rejects tool execution and arbitrary endpoints, and reuses the repository PCM module for capture and playback. Authored text replay stays separate.

## Setup

Live voice requires an already operating authenticated bridge. Configure M8_DEMO_BRIDGE_URL, M8_DEMO_BRIDGE_TOKEN and M8_DEMO_BRIDGE_ORIGIN only in the demo server environment. Remote bridges must use wss; a loopback SSH forward may use ws. The URL must end in /gemini and contain no credentials or query parameters. A real passkey session is required before connecting. The browser receives neither the bridge token nor a provider key. The microphone is requested only after its button is pressed. No bridge is started or changed by this demo. Live-provider and microphone acceptance remain pending until a valid bridge and the holder are available. The existing authored replay is not evidence of live voice.

Run the demo with `npm start` from this directory and open its documented localhost origin. The static directory is `public`; configuration, adapters and private run folders are never served as static files.

## Access and outputs

The existing FIDO2/WebAuthn workspace flow remains in place. Real holder registration, sign-in and second-key recovery still require holder interaction. Live provider actions require a verified session. There is no demo authentication bypass.

Machine-only acceptance can use an explicitly configured DEMO_SERVICE_TOKEN of at least 32 random bytes. Keep it in a private server environment and never in browser code or URLs. It represents a service identity, not a human passkey test. No token is included in this repository.

Each engine task writes only beneath its own ignored `.demo-state/engine/<run>` directory. Download links require the same browser ownership cookie (or the configured service identity). Jobs expire after one hour in memory; disk files are retained locally for recovery and are not automatically deleted. No production database or existing service is changed. Stop this local demo normally when finished.

The gateway rejects foreign origins, unknown actions, oversized input, cross-session artifact access and outputs outside the job directory. Raw provider errors stay in private run logs. It never accepts an arbitrary remote URL or a filesystem path from the browser.

## Acceptance

The adapter is exercised separately from its browser journey; see VERIFY.md. `npm test` includes origin, access, job ownership and error-isolation checks. Physical passkey and live-provider limits are stated explicitly. Preserve `.demo-state` before removing or replacing this isolated demo if its outputs matter.
