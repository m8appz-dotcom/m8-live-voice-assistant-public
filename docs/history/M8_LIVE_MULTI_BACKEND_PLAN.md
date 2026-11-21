# M8 Live Multi-Backend Plan

Date: 2026-05-02
Status: future implementation note

## Product direction

M8 Live should evolve from an app connected only to Adrian's OpenClaw into a universal client for personal operators.

The product promise:

> Talk to your personal operator and connect it to your own stack.

This makes the app useful to other users without requiring everyone to run Adrian's exact OpenClaw setup.

## Core idea

Add a backend connector layer between Gemini Live and the user's systems.

Gemini should not need to know whether the connected backend is OpenClaw, n8n, Home Assistant, Zapier, Make, MCP, or a hosted M8 backend. It should see a stable set of common tools. The app/proxy translates those tool calls to the selected backend.

## Initial connector types

Start with three connectors, not twenty.

### 1. OpenClaw connector

For power users and existing OpenClaw operators.

Capabilities:
- Dispatch tasks to OpenClaw agents.
- Check task/dispatch status.
- Search/save memory where available.
- Route device or notification actions through OpenClaw where appropriate.

### 2. Webhook connector

Universal bridge for n8n, Make, Zapier, custom APIs, and simple automations.

Capabilities:
- Call a configured webhook.
- Pass structured task payloads.
- Receive status/result responses.
- Support simple auth headers/tokens.

This is the fastest way to make M8 useful outside OpenClaw.

### 3. Hosted M8 connector

For normal users who do not have their own backend.

Capabilities:
- Durable memory.
- Tasks/reminders.
- Basic webhooks.
- Basic integrations over time.

This avoids making self-hosting a requirement.

## Onboarding flow

Add a setup screen: "Connect your system".

Supported setup methods:
- Scan QR code.
- Paste backend URL.
- Login/OAuth where supported.
- Enter API key/token.
- Choose demo mode.

Each user should get a profile similar to:

```json
{
  "name": "Adrian",
  "operatorName": "M8",
  "backendType": "openclaw",
  "baseUrl": "https://example.com",
  "auth": {
    "type": "token"
  },
  "enabledTools": [
    "send_task",
    "check_status",
    "memory_search",
    "memory_save"
  ]
}
```

Do not store raw secrets in plaintext. Use secure device storage or server-side encrypted storage depending on deployment mode.

## Common tool layer

Expose stable tools to Gemini Live regardless of backend.

Recommended first tool set:
- `send_task`
- `check_status`
- `memory_search`
- `memory_save`
- `call_webhook`
- `control_device`
- `open_url`

Backend adapters translate these into actual backend calls.

Example mappings:

| Common tool | OpenClaw | Webhook | Hosted M8 |
| --- | --- | --- | --- |
| `send_task` | dispatch to agent | POST webhook | create hosted task |
| `check_status` | dispatch status | GET/POST status webhook | hosted task status |
| `memory_search` | OpenClaw/wiki memory | optional webhook | hosted memory |
| `memory_save` | OpenClaw/wiki memory | optional webhook | hosted memory |
| `call_webhook` | proxy external call if allowed | direct connector action | hosted webhook action |

## Skill/vertical marketplace later

Once connectors work, package opinionated configurations as skills:
- Personal assistant
- Smart home / Home Assistant
- Trading copilot
- Support technician
- CRM / leads
- Inbox triage
- Creator tools

These should mostly be presets over prompts, tools, connectors, and permissions.

## Security rules

- Ask confirmation before destructive, public, financial, privacy-sensitive, or irreversible actions.
- Never save API keys, passwords, tokens, private credentials, or secret-looking text as memory.
- Keep backend tokens out of Gemini-visible context.
- Use scoped connector permissions.
- Show users which connector/tool will be used before sensitive actions.
- Support disconnect/revoke.

## Implementation phases

### Phase 1: Adapter abstraction

- Define connector profile schema.
- Add connector registry in app/proxy.
- Move current OpenClaw-specific logic behind an `openclaw` adapter.
- Keep existing Adrian/OpenClaw behavior as the default migration path.

### Phase 2: Webhook connector

- Add UI for webhook URL + auth.
- Add `call_webhook`, `send_task`, and optional `check_status` mapping.
- Add demo n8n/Make/Zapier examples.

### Phase 3: Hosted M8 backend

- Provide hosted memory + tasks for non-technical users.
- Add account/user profile support.
- Add billing/limits later if needed.

### Phase 4: Connector marketplace

- Add presets/skills.
- Add Home Assistant, Slack/Discord, MCP, CRM integrations.

## Recommended next build task

Implement Phase 1 first:

1. Create a `ConnectorProfile` type.
2. Create a `BackendAdapter` interface.
3. Wrap current OpenClaw dispatch/memory routes as the first adapter.
4. Add a simple connector selection/onboarding screen.
5. Keep current production config working for Adrian with no behavior regression.

## Non-goals for first pass

- Do not build a large marketplace immediately.
- Do not add many integrations before the adapter contract is stable.
- Do not expose backend internals to Gemini or the end user.
- Do not require users to understand OpenClaw to use M8 Live.
