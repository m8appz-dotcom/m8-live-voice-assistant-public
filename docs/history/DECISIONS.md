# Decisions — M8 Live

## 2026-03-08 — Expo over bare React Native
**Context:** Need cross-platform mobile app with audio/camera
**Decision:** Use Expo (managed workflow) with expo-av
**Alternatives:** Bare RN (more control, more config), Flutter (different language)
**Impact:** Faster dev cycle, OTA updates, but some native module limitations

## 2026-03-08 — Push-to-talk over VAD for V1
**Context:** Voice input needs to know when user is speaking
**Decision:** Push-to-talk (hold button) for V1
**Alternatives:** Voice Activity Detection (hands-free but complex, false triggers)
**Impact:** Simpler, more reliable. VAD planned for V2.

## 2026-03-08 — Deepgram for STT
**Context:** Need real-time speech-to-text
**Decision:** Deepgram streaming WebSocket API
**Alternatives:** Whisper (batch, higher latency), Google STT (more complex auth)
**Impact:** Low latency streaming, good accuracy, simple WS API

## 2026-03-08 — ElevenLabs for TTS
**Context:** Need natural voice output from agent
**Decision:** ElevenLabs WebSocket streaming
**Alternatives:** OpenAI TTS (simpler but no streaming), Kokoro (local, no streaming on mobile)
**Impact:** Natural voice, streaming playback, but cost per character

## 2026-03-08 — Zustand over Redux
**Context:** State management for session, audio, connection states
**Decision:** Zustand — minimal boilerplate, works great with RN
**Alternatives:** Redux (too heavy for V1), Jotai (atomic but less structured)
**Impact:** Clean store pattern, easy to test

## 2026-03-10 — React Native Skia for NativeOrb
**Context:** Need high-performance, complex glowing orb animation on native mobile (identical to Canvas on Web) without melting battery.
**Decision:** Use `@shopify/react-native-skia` for rendering the layers and glow, but wrap it in an `Animated.View` for the breathing scale animation using the native driver.
**Alternatives:** Pure React Native `View` (too basic, no gradient/blur support without severe performance hit), Skia `useSharedValue` for everything (high CPU usage for simple scale animation).
**Impact:** Beautiful GPU-accelerated gradient graphics, combined with ultra-low CPU cost for the continuous pulse animation.

## 2026-03-10 — Android Build Path Relocation
**Context:** Local Android Release build failed with C++ `ninja: error: Stat(...): Filename longer than 260 characters` due to Skia's deep path structure.
**Decision:** Robocopy the project to a root-level short path (`C:\dev\oclive`) for the build phase.
**Alternatives:** Enable Windows long paths via Registry/GPO (unreliable for all NDK/CMake tools).
**Impact:** Android C++ compilation succeeds, but creates a manual step for releasing APKs from Windows machines.

## 2026-04-12 — Split M8 Live bridge into token, events, device tools, and OpenClaw tool routes
**Context:** The app needed a realtime refactor without changing the current UI. The previous bridge mixed notifications into conversation turns, used one generic OpenClaw tool path, and had config drift between documented and implemented endpoints.
**Decision:** Keep the current live screen UI, add explicit service modules, expose `/api/token`, `/api/tools/openclaw-command`, `/api/tools/openclaw-message`, and `WS /events`, and separate local device tool execution from remote OpenClaw orchestration.
**Alternatives:** Keep the monolithic `app/live.tsx` tool bridge and `/api/inject` conversation injection pattern, or move all device control back behind OpenClaw.
**Impact:** Lower coupling, cleaner realtime architecture, structured notification delivery, and a path to native-device-first execution without changing the screen design.

## 2026-04-12 — Reduce M8 Live latency on native playback and tool waits
**Context:** Android responses felt slow even when the model was ready because the native client buffered audio too conservatively and remote OpenClaw tool waits could stall the conversation for up to a minute.
**Decision:** Start native playback on the first audio chunk, flush every subsequent chunk immediately, reduce VAD silence thresholds, and cap OpenClaw tool waits at 12 seconds instead of 60 seconds.
**Alternatives:** Keep the current buffering and long waits, or fully rewrite the audio path before shipping any latency improvements.
**Impact:** Faster perceived response start on Android, less dead air after user speech ends, and shorter stalls when a remote tool call is slow or degraded.

## 2026-04-12 — Point Android fallback proxy to the temporary Tailscale-backed live bridge
**Context:** The production `live.m8apps.com` deploy was serving mixed behavior, with `/api/health` responding but `/api/token` falling through to the static SPA, while Android users were seeing disconnect code 1007 on launch.
**Decision:** Change the native fallback proxy base to the active Tailscale Funnel bridge at `https://titan-win.tailb235ab.ts.net/live` and remove leftover `OpenClaw Live` branding from the app shell.
**Alternatives:** Keep shipping against the broken production host, or pause delivery until the production bridge is redeployed correctly.
**Impact:** The shipped APK targets the bridge that is actually under our control right now, restoring connectivity for immediate testing while the production hostname is fixed separately.

## 2026-04-13 — Route M8 Live OpenClaw tools through a dedicated coder session
**Context:** Direct `agent` RPC calls from the bridge were hitting auth and timeout failures on the default session path, which made Android appear unable to reach OpenClaw even when network connectivity was fine.
**Decision:** Move bridge tool execution to a dedicated persisted session `agent:coder:m8-live-bridge`, force that session onto `openai-codex/gpt-5.4`, and call it through `sessions.create` + `sessions.patch` + `sessions.send` + `sessions.get` polling instead of `agent`/`agent.wait`.
**Alternatives:** Keep the default bridge session and accept intermittent timeouts, or remove OpenClaw features from the app entirely.
**Impact:** OpenClaw tool requests from the mobile app now resolve against a stable fast session instead of the slow default path, while preserving the rest of the app architecture.

## 2026-04-13 — Unify web and Windows widget with the APK live experience
**Context:** `live.m8apps.com/live` was serving an older web build than the APK, and the Windows widget was a separate Electron renderer with different UI, endpoints, and realtime behavior.
**Decision:** Treat the Expo app as the single source of truth for APK and web, redeploy the current Expo web export plus the updated Spark proxy, and convert the Windows widget into a thin Electron shell that loads `https://live.m8apps.com/live` instead of shipping a separate renderer.
**Alternatives:** Keep maintaining the widget as a second frontend, or keep the older web deploy while only updating APK/mobile.
**Impact:** APK, web, and Windows widget now share one live UI and one realtime flow against the Spark-backed proxy, reducing drift and making future changes land in one place.

## 2026-04-21 — Lock down the live bridge and remove implicit OpenClaw auth
**Context:** The live proxy exposed token, relay, event, notify, and OpenClaw tool routes publicly with permissive CORS, and repo probes contained a hardcoded gateway token.
**Decision:** Require a bridge token for sensitive HTTP and WebSocket routes, restrict CORS to explicit origins, stop reading the OpenClaw gateway token from local config, gate OpenClaw and notification routes behind explicit env flags, remove legacy `/api/inject` behavior, and strip hardcoded tokens from probe scripts.
**Alternatives:** Leave the proxy public and rely on obscurity, or remove the bridge entirely.
**Impact:** The bridge is no longer an unauthenticated public relay into Gemini/OpenClaw by default, and deployment now requires explicit auth/config for sensitive functionality.

## 2026-04-21 — Use password-issued HttpOnly web sessions instead of shipping bridge tokens in the web bundle
**Context:** Re-enabling OpenClaw web routes with `EXPO_PUBLIC_BRIDGE_TOKEN` would leak a reusable bridge secret to every browser that loads the app, which makes sensitive routes effectively public by extraction.
**Decision:** Add `POST /api/bridge/session` to exchange a bridge access password for a signed HttpOnly session cookie, accept either that cookie or a bearer bridge token on protected bridge routes, and require the web UI to unlock the bridge before connecting.
**Alternatives:** Keep OpenClaw web routes disabled forever, or keep embedding a shared bridge token in the public bundle.
**Impact:** Web clients can authenticate without receiving a reusable bearer token, which makes re-enabling OpenClaw bridge routes materially safer while keeping native/non-browser clients compatible.
