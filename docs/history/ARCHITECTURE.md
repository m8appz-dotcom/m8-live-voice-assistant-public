# Architecture — M8 Live

## Goal
Web-first M8 Live client with direct Gemini Live WebSocket sessions, ephemeral token provisioning from a local backend bridge, and OpenClaw integration through explicit tool endpoints.

## Core routing
- Frontend -> M8 Live bridge for low-latency realtime audio/text
- Frontend -> local bridge for ephemeral tokens
- Frontend -> local bridge for OpenClaw-backed tool calls
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
- Direct Live API session over WebSocket using ephemeral token
- Text input supported
- Web microphone streaming supported with PCM 16k downsampling
- Web PCM audio playback supported for Live API native audio output
- Tool bridge endpoints:
  - `send_openclaw_message`
- Current bridge intentionally degrades when gateway token scopes are insufficient.

## Deliberate limitations
- Native mobile realtime audio path is not finished in this pass
- Camera/video path is not implemented yet
- Web bridge auth is still password-to-session based, not full end-user identity based
- OpenClaw bridge is intentionally narrow and explicit, not a generic arbitrary RPC tunnel
