# M8 Live full-read message architecture

Date: 2026-05-04
Status: implementation started

## Decision

Build full-read only through official or user-consented channels:

- Telegram: official Telegram client API / TDLib.
- Gmail/mail: Gmail API or provider OAuth/IMAP/Graph.
- SMS: Android `READ_SMS` / Telephony provider for private APK or default-SMS-app builds.
- WhatsApp personal: notification previews only, plus optional visible assisted mode through Accessibility. Do not promise reliable full history.
- WhatsApp Business: Cloud API only for Business numbers connected to M8, not personal WhatsApp history.

## Why

Android Notification Listener is useful, but it only sees what apps publish into notifications. It can expose expanded text or MessagingStyle lines, but not guaranteed complete history.

WhatsApp personal has no official read-all API. Root/database extraction, linked-device automation, or hidden Accessibility scraping would be brittle and privacy-hostile. M8 Live should stay explicit and inspectable.

## Capability map

| Channel | Full history | New messages | Recommended implementation | Notes |
| --- | --- | --- | --- | --- |
| Telegram | Yes | Yes | TDLib service with user login/2FA | Best official path. Store session securely server-side or in app secure storage. |
| Gmail | Yes | Yes | Gmail API OAuth scopes, or IMAP/Graph for non-Gmail | Use least scopes; summarize before speaking. |
| SMS | Yes on Android | Yes on Android | `READ_SMS` Telephony provider or default SMS app | Play Store restricted unless core SMS/default handler. Private APK acceptable. |
| WhatsApp personal | No official path | Notification previews | Notification Listener; optional visible Accessibility mode | No silent full-read promise. |
| WhatsApp Business | Only Business account messages | Yes | Meta WhatsApp Cloud API webhooks | Separate product flow from personal WhatsApp. |

## Local Android implementation started

M8 Live Android now has the substrate for the local side:

- Manifest includes `android.permission.READ_SMS`.
- Native Android status reports `smsReadGranted`.
- Native module exposes `readSmsInbox(max)`.
- Gemini tool layer exposes `android_read_sms_inbox`.
- Notification listener now returns richer fields: `bigText`, `summaryText`, `textLines`, and `messages` from Android MessagingStyle when available.
- Device operator tools now prefer semantic Accessibility actions over raw coordinates: `android_click_text` clicks by visible text/content description/view id, and `android_wait_for_text` verifies post-action screen state.

## Security rules

- Full message bodies are privacy-sensitive.
- Default should be read-on-demand, not continuous ingestion.
- Do not persist message bodies unless Adrian explicitly enables storage.
- Prefer returning sender/date/snippet for broad queries; fetch bodies only for selected messages or explicit “lee completo”.
- Keep OAuth tokens and TDLib database encryption keys out of Gemini-visible context.
- Require explicit confirmation before sending, deleting, archiving, marking read, or replying.

## Backend shape

Implemented proxy endpoints:

```http
GET /api/messages/capabilities
GET /api/messages/telegram/status
GET /api/messages/telegram/search?q=...&limit=10
GET /api/messages/telegram/thread?chatId=...&fromMessageId=...&limit=20
GET /api/messages/gmail/status
GET /api/messages/gmail/auth/start
GET /api/messages/gmail/oauth/callback
GET /api/messages/gmail/search?q=...&limit=10
GET /api/messages/gmail/message?id=...
```

Planned generalized endpoints once SMS server connectors are added:

```http
GET /api/messages/search?source=telegram|gmail|sms&q=...
GET /api/messages/thread/:source/:threadId
POST /api/messages/connect/:source
DELETE /api/messages/connect/:source
```

Message object:

```json
{
  "id": "provider-message-id",
  "source": "telegram",
  "threadId": "provider-thread-id",
  "sender": "Name or address",
  "timestamp": 1777910000000,
  "subject": "Optional email subject",
  "snippet": "Short preview",
  "body": "Full body only when explicitly requested",
  "attachments": []
}
```

## Telegram TDLib connector

M8 Live proxy now supports a Telegram connector through a local TDLib bridge:

- Proxy env: `M8LIVE_TELEGRAM_TDLIB_BRIDGE_URL=http://127.0.0.1:7311`.
- Optional proxy-to-bridge auth: `M8LIVE_TELEGRAM_TDLIB_BRIDGE_TOKEN`.
- Bridge script: `connectors/telegram-tdlib-bridge.mjs`.
- The bridge uses TDLib via the Node `tdl` wrapper and `prebuilt-tdlib` optional dependency.
- Required Telegram credentials: `TELEGRAM_API_ID`, `TELEGRAM_API_HASH`, and interactive login/2FA on first run.
- The bridge stores TDLib database/files under `.tdlib/` by default; keep this out of git and treat it as sensitive session data.

M8 Live Gemini tools added:

- `message_sources_status`
- `telegram_message_search`
- `telegram_message_thread`

## Gmail OAuth connector

M8 Live proxy now supports Gmail full-read through Gmail API OAuth:

- Env: `M8LIVE_GMAIL_OAUTH_CLIENT_ID`, `M8LIVE_GMAIL_OAUTH_CLIENT_SECRET`, `M8LIVE_GMAIL_OAUTH_REDIRECT_URI`.
- Private-host alternative: `M8LIVE_GMAIL_ACCESS_TOKEN_COMMAND`, for example `gcloud auth print-access-token` after Gmail-scoped gcloud login.
- Default scope: `https://www.googleapis.com/auth/gmail.readonly`.
- Token store: `.gmail-oauth.json`, ignored by git and written mode `0600`.
- Auth start endpoint returns a Google consent URL; callback exchanges code and stores refresh token.
- Search endpoint uses Gmail query syntax and returns metadata/snippets only.
- Full body endpoint requires an explicit message id and returns parsed text body.

M8 Live Gemini Gmail tools added:

- `gmail_auth_status`
- `gmail_message_search`
- `gmail_message_read_full`

## Build order

1. Android SMS + richer notifications. Done for substrate.
2. Telegram TDLib connector service. Proxy/app substrate done; runtime needs TDLib dependencies + login.
3. Gmail OAuth connector service. Proxy/app substrate done; runtime needs Google OAuth client + consent.
4. M8 Live UI: “Message sources” screen with enable/disable, status, and no-storage toggle.
5. Gemini/OpenClaw tools: `message_search`, `message_thread`, `message_read_full`, `message_reply_draft`.

## Non-goals

- No root-only WhatsApp database reader.
- No hidden WhatsApp Web automation as core infrastructure.
- No background collection of all message bodies by default.
