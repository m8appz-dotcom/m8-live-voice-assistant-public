# Architecture — M8 Live

## Goal
Web-first M8 Live client with direct Gemini Live WebSocket sessions, ephemeral token provisioning from a local backend bridge, and hidden OpenClaw orchestration behind Gemini tool use.

## Core routing
- Frontend -> M8 Live bridge for low-latency realtime audio/text
- Frontend -> local bridge for ephemeral tokens
- Frontend -> local bridge for Gemini-invoked local/remote tool calls
- OpenClaw remains sessions/tools/memory/routing, not audio transport

## Bridge security model
- Sensitive bridge routes require either `BRIDGE_AUTH_TOKEN` or a valid signed bridge session cookie
- Web clients create that session with `POST /api/bridge/session`, which sets an HttpOnly cookie after password verification
- Native/non-browser clients can still use an explicit bearer bridge token when needed
- CORS is restricted to `BRIDGE_ALLOWED_ORIGINS`
- OpenClaw tool routes are disabled unless `BRIDGE_ENABLE_OPENCLAW_ROUTES=1`
- Notification/event routes are disabled unless `BRIDGE_ENABLE_NOTIFICATION_ROUTES=1`
- The bridge no longer reads gateway auth from `~/.openclaw/openclaw.json`; it uses explicit env only

## Current implementation
- Expo app, web-first
- Direct Live API session over WebSocket using ephemeral token/relay
- Text input supported as the same conversational channel as voice
- Web microphone streaming supported with PCM 16k downsampling
- Web PCM audio playback supported for Live API native audio output
- Gemini built-in tools available for search/url context
- Local device tools available for camera, mic, files, haptics, and links
- One remote delegation tool is available for hidden OpenClaw execution:
  - `openclaw_dispatch`
- The bridge chooses Emma, Builder, or Video Ops from the target/instruction while keeping agent orchestration out of the visible UI
- Dispatch persistence/events may still exist internally, but they are implementation detail rather than product UX
- Current bridge intentionally degrades when gateway token scopes are insufficient.

## Deliberate limitations
- Native mobile realtime audio path is not finished in this pass
- Camera/video path is only partially implemented
- Web bridge auth is still password-to-session based, not full end-user identity based
- Internal dispatch persistence is file-backed for now, not DB-backed
- OpenClaw bridge is intentionally narrow and explicit, not a generic arbitrary RPC tunnel
- The user-facing app should not expose agent orchestration state except during debugging
