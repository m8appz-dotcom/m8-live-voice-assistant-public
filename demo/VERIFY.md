# Verification and limits

The five-demo implementation was exercised through the Codex browser MCP in hidden tabs on X. The approved screens remain the baseline. No desktop focus or native keyboard input was used.

Verified for this demo:

- Choose an authored example question.
- Start, pause, resume or interrupt its text replay.
- Read the saved transcript and export completed or interrupted turns.

Shared checks: English visible/accessible content; desktop, narrow and intermediate compositions; local persistence; workspace export, compatible restore, invalid-file rejection and undo through the shared recovery UI. Product-specific JSON, CSV and ZIP files were downloaded and read independently. The locked Longform contract's SHA-256 matches its canonical UTF-8 script; the Toolkit ZIP passes a standard ZIP reader and preserves its selected originals.

Corrections during browser review included an editor/navigation overlap in Longform, the narrow JEV status selector, preservation of incomplete JEV review notes and placement of M8 replay controls. Original source images were not modified.

Automated checks reject unsigned workspace access, foreign-origin mutations, invalid registration, replayed challenges and unknown credentials. Real holder registration/login/recovery remains pending. Full accessibility certification, physical mobile-device testing, paid/live AI calls, microphone/audio acceptance and finished-video acceptance are not claimed.

Scope limit: This is an authored text conversation explorer. It does not record a microphone, play generated speech, connect a live model or execute external tools.

## Connected engine update

Adds a private server-to-server WebSocket adapter for an existing M8 `/gemini` bridge. It preserves gemini-3.1-flash-live-preview and Zephyr, fixes English instructions, rejects tool execution and arbitrary endpoints, and reuses the repository PCM module for capture and playback. Authored text replay stays separate.

Gateway negative tests cover origin, protected actions, session ownership, unsupported input, invalid service credentials, safe errors and path containment. Physical holder passkey acceptance remains pending; it is never inferred from these tests.
