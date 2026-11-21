# m8live unification log — 2026-04-13

## Goal
Unify the Android APK, the web app at `https://live.m8apps.com/live`, and the Windows widget so they share the same behavior, UI direction, and live backend.

## Canonical decisions
- Canonical frontend source of truth: `C:\Users\M8\Projects\Gemini Live`
- Canonical product name: `m8live`
- Canonical live backend: Spark
- Canonical live model: `gemini-3.1-flash-live-preview`
- Titan `/live` route removed from the old path. Spark now owns the live route.
- Windows widget is no longer a separate frontend. It is now a shell for `https://live.m8apps.com/live`.

## Root cause found
The original Android and web live failures were caused by the old Titan live proxy path being down or mismatched:
- `ws://127.0.0.1:7300/gemini` returned connection refused
- `wss://titan-win.tailb235ab.ts.net/live/gemini` returned `502`
- Spark already had the working live backend on port `7300`

## Spark backend state verified
Spark host:
- host: `100.121.147.73`
- runtime path: `/home/m8apps/openclaw-live/proxy.mjs`
- port: `7300`
- verified health response: `{"ok":true,"model":"gemini-3.1-flash-live-preview"}`

## Routing changes
- Published Spark Tailscale route:
  - `https://spark.tailb235ab.ts.net/live -> 127.0.0.1:7300`
- Removed `/live` from Titan-win serve config
- `https://live.m8apps.com/live` now resolves through the Spark-backed live deployment

## App changes in Gemini Live
Files updated earlier in the Expo app to align branding and backend:
- `app.json`
  - `name = m8live`
  - `slug = m8live`
  - `scheme = m8live`
- `src/services/appConfig.ts`
  - fallback proxy set to `https://spark.tailb235ab.ts.net/live`
  - live model set to `gemini-3.1-flash-live-preview`
- `app/index.tsx`
  - biometric message updated to `m8live`
- `app/_layout.tsx`
  - title updated to `m8live`
- `app/setup.tsx`
  - title updated to `m8live Setup`

## Proxy deployment issue and fix
After deploying the updated web build and proxy to Spark, the proxy failed to boot because the OpenClaw call module was not auto-resolved correctly on Spark.

Observed failure:
- `Error: Unable to locate openclaw call module. Set OPENCLAW_CALL_MODULE_PATH.`

Confirmed OpenClaw install on Spark:
- `/usr/lib/node_modules/openclaw/openclaw.mjs`
- call bundle path used:
  - `/usr/lib/node_modules/openclaw/dist/call-Iw4xDZUX.js`

Operational fix applied on Spark:
- set `OPENCLAW_CALL_MODULE_PATH=/usr/lib/node_modules/openclaw/dist/call-Iw4xDZUX.js` in `/home/m8apps/openclaw-live/.env`
- restarted proxy
- confirmed port `7300` was owned again by `/usr/bin/node /home/m8apps/openclaw-live/proxy.mjs`

## Web validation
Validation after recovery:
- `https://live.m8apps.com/api/health` returned `200`
- reported model: `gemini-3.1-flash-live-preview`
- `https://live.m8apps.com/live` served the new Expo build
- `wss://live.m8apps.com/gemini` opened successfully

This confirmed that the public web app is now serving the current APK-aligned frontend instead of the old stale build.

## Windows widget unification
Repository:
- `C:\Users\M8\Projects\m8live-widget`

Structural change:
- old Electron renderer is no longer the active product frontend
- `main.js` now loads `https://live.m8apps.com/live`
- Electron media and display capture permissions were enabled for parity with the live web app
- product branding updated to `m8live`

Files changed:
- `main.js`
- `package.json`
- `assets/icon.ico`

Packaging issue found:
- widget build originally failed because `assets/icon.ico` was invalid
- fix was replacing that icon with a valid `.ico`
- after that, the installer built correctly

## Validation results
Gemini Live:
- `npm exec tsc -- --noEmit` passed
- `npm run build:web` passed

Widget:
- `npm run build` passed
- generated installer:
  - `C:\Users\M8\Projects\m8live-widget\dist\m8live Setup 1.0.0.exe`

## Commits created
Gemini Live:
- `a219ad1` — `fix(app): move m8live to spark live backend`
- `ff9601b` — `fix(app): point m8live fallback to spark serve`
- `7c0f713` — `fix(proxy): unify web live bridge on spark`

m8live-widget:
- `c13142c` — `refactor(widget): load unified live app shell`
- `705fe12` — `chore(widget): drop unused bundled renderer files`

## Current outcome
- APK, web, and widget are now aligned around one frontend source of truth
- Spark is the canonical live backend
- public web is serving the current app build
- widget is now a shell for the same public live app
- remaining artifact work is release packaging and distribution, not architecture unification

## Canonical paths
- app repo: `C:\Users\M8\Projects\Gemini Live`
- widget repo: `C:\Users\M8\Projects\m8live-widget`
- Spark live deploy: `/home/m8apps/openclaw-live`
- public live URL: `https://live.m8apps.com/live`
- widget installer: `C:\Users\M8\Projects\m8live-widget\dist\m8live Setup 1.0.0.exe`
