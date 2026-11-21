# Auditoría — M8 Live
_Fecha: 2026-06-12_

## Resumen ejecutivo

El repo es un cliente Expo (web + Android/iOS) que conecta directamente a Gemini Live API vía WebSocket a través de un bridge server local. La arquitectura de seguridad está bien pensada y ha mejorado significativamente (lockdown 2026-04-21). El problema central es que `app/live.tsx` es un **god-component de 2.466 líneas** que mezcla motor de audio, WebGL/Three.js, cámara nativa, WebSocket, tool calls, auth UI y manejo de notificaciones. Es el riesgo de mantenibilidad más serio del proyecto.

---

## 🔴 Alta prioridad

### 1. `app/live.tsx` — god component de 2.466 líneas
El archivo concentra todo: ThreeOrb WebGL, AudioSpectrum, audio engine web y nativo, mic recording, camera/screen capture, WebSocket session, tool call dispatch, bridge auth UI, passkey UI, event stream, wake injection y notificaciones. Cualquier cambio en una parte toca el resto.

**Refactor sugerido:**
- `hooks/useGeminiSession.ts` — WebSocket lifecycle, send/receive
- `hooks/useAudioEngine.ts` — web AudioContext + native queue
- `hooks/useMicRecorder.ts` — web ScriptProcessor + native recorder
- `hooks/useVideoCapture.ts` — web camera/screen + native CameraView
- `components/ThreeOrb.tsx` — Three.js orb (ya tiene lógica autocontenida)
- `components/AudioSpectrum.tsx` — 40-bar visualizer
- `components/BridgeAuthGate.tsx` — overlay de password/passkey
- `app/live.tsx` — queda como compositor delgado

### 2. `ScriptProcessorNode` está deprecado
`live.tsx:1461` usa `createScriptProcessor(4096, 1, 1)` para captura del mic web. Esta API está **deprecada en todos los browsers modernos** y corre en el main thread, lo que introduce glitches de audio y puede causar caídas silenciosas.

**Fix:** Migrar a `AudioWorkletNode`. El worklet corre en un hilo dedicado, elimina el jitter del main thread y tiene mejor latencia neta.

```ts
// Reemplazar:
const proc = ctx.createScriptProcessor(4096, 1, 1)
// Por:
await ctx.audioWorklet.addModule('/mic-processor.worklet.js')
const worklet = new AudioWorkletNode(ctx, 'mic-processor')
worklet.port.onmessage = (e) => { /* enviar PCM */ }
```

### 3. `@simplewebauthn/server` en dependencias del cliente
`package.json` incluye `@simplewebauthn/server: ^13.3.0` — es una librería **server-side** (Node.js). No tiene uso en el bundle de Expo y suma peso innecesario. El código de passkey en el cliente solo usa `@simplewebauthn/browser`, que sí pertenece aquí.

**Fix:** Mover `@simplewebauthn/server` al package.json del bridge server. Eliminarlo del cliente.

### 4. Settings no se auto-guardan
`src/stores/settings.ts` carga settings al importar (`loadStorage()`) pero el método `set` del store Zustand **no llama a `saveSettings()`**. Si el usuario cambia algo en la pantalla de settings y `app/settings.tsx` no llama explícitamente a `saveSettings()` al salir, los cambios se pierden en el próximo reinicio.

**Fix:** Añadir un subscriber en el store:
```ts
useSettings.subscribe(
  (state) => { const { set: _, reset: __, ...data } = state; storageModule?.setItem('app_settings', JSON.stringify(data)) }
)
```
O llamar `saveSettings()` explícitamente en el unmount de la pantalla de settings.

### 5. Sin reconexión automática (sesión + event stream)
Si el WebSocket de Gemini cae por un cambio de red o timeout, el usuario debe tocar el error bar manualmente. El event stream (`connectAppEventStream`) tampoco reconecta. En mobile, las conexiones caen frecuentemente al bloquear la pantalla.

**Fix:** Implementar backoff exponencial con jitter en ambos:
```ts
let retryDelay = 1000
const reconnect = () => {
  retryDelay = Math.min(retryDelay * 2, 30000)
  setTimeout(connect, retryDelay + Math.random() * 500)
}
ws.onclose = (e) => { if (e.code !== 1000) reconnect() }
```

---

## 🟡 Prioridad media

### 6. Tailscale URL hardcodeada en source
`src/services/appConfig.ts:6`:
```ts
const FALLBACK_PROXY_URL = 'https://spark.tailb235ab.ts.net/live'
```
Una dirección Tailscale privada está grabada en el código fuente. Si el tailnet cambia o se elimina ese nodo, el fallback falla silenciosamente en builds anteriores que ya estén instalados.

**Fix:** Eliminar el fallback hardcodeado. Si `EXPO_PUBLIC_PROXY_URL` está vacío en nativo, mostrar un error claro en lugar de fallar con una URL rota.

### 7. Args de tool calls expuestos en el chat
`live.tsx:1381`:
```ts
addMsg('user', `[Tool: ${call.name}] ${JSON.stringify(call.args || {})}`)
```
Cada llamada a `openclaw_dispatch` muestra `instruction`, `target`, `project` y `priority` en el chat. DECISIONS.md (2026-04-22) dice explícitamente: "users should not interact with Builder, Video Ops, or Emma as first-class UI entities" y "Do not expose orchestration internals."

**Fix:** Mostrar solo el nombre del tool (no los args) o no mostrar tool calls en el chat, solo el resultado que M8 resume.

### 8. Decisión `'queue'` no implementada en `notificationPolicy`
`notificationPolicy.ts` puede retornar `'queue'` para notificaciones de prioridad alta cuando el mic está activo. En `live.tsx`, solo `'interrupt'` y `'ignore'` tienen tratamiento diferenciado — `'surface'` y `'queue'` producen exactamente el mismo comportamiento (solo se agrega al chat). La cola no existe.

**Fix:** Implementar un buffer de notificaciones que se inyecten cuando el turn completa, o colapsar `'queue'` con `'interrupt'` si esa es la intención.

### 9. `@google/genai` en dependencias del cliente
`package.json` incluye `@google/genai: ^1.30.0`. En el código del cliente solo se usan `fetch` y `WebSocket` nativos hacia el bridge — no hay imports de `@google/genai` en ningún archivo de `app/` o `src/`. Esta dependencia pertenece al bridge server.

**Fix:** Eliminarlo del cliente. Ahorra bundle size.

### 10. ThreeOrb no limpia recursos GPU
El cleanup en `live.tsx:549-556` solo remueve el `<canvas>` del DOM pero no llama:
```ts
renderer.dispose()
orbGeometry.dispose()
orbMaterial.dispose()
// etc.
```
Si `ThreeOrb` se remonta (cambio de tab y vuelta), los recursos de GPU se acumulan.

**Fix:** En el `return () => {}` del useEffect, llamar `.dispose()` en geometries, materials y el renderer.

### 11. DECISIONS.md parcialmente desactualizado
Las entradas de 2026-03-08 mencionan Deepgram (STT) y ElevenLabs (TTS) como decisiones activas. La implementación actual usa Gemini Live nativo para audio (el modelo devuelve PCM directamente). Esto confunde a quien lea el doc buscando entender el stack actual.

**Fix:** Actualizar o añadir una entrada que marque Deepgram/ElevenLabs como `[SUPERSEDED]` y documente la decisión de usar Gemini Live audio nativo.

### 12. `isConnected` excluye `'thinking'` y `'searching'`
```ts
const isConnected = state === 'ready' || state === 'listening' || state === 'responding'
```
Durante un tool call (estados `thinking`/`searching`), los botones del dock aparecen deshabilitados y el input de texto está bloqueado. El usuario no puede interrumpir ni escribir mientras M8 está procesando una herramienta, lo que puede hacer que la UI parezca congelada.

**Fix:** Incluir `'thinking'` y `'searching'` en `isConnected`, o al menos habilitar el botón de mic para interrumpir.

---

## 🟢 Baja prioridad / style

### 13. Debug `console.log` en producción
Tres logs de debug en `live.tsx` que deberían eliminarse o ponerse detrás de `__DEV__`:
- `console.log('[m8live] toolCall args', ...)` — línea ~1380
- `console.log('[m8live] bridge session status', ...)` — línea ~1770
- `console.log('[m8live] bridge unlocked', ...)` — línea ~1719

### 14. `clock.getDelta()` con resultado descartado
`live.tsx:401`: `clock.getDelta() // drain delta` — se llama solo para efecto secundario. El comentario lo reconoce pero es un anti-patrón. Puede omitirse o usar `clock.getElapsedTime()` directamente sin el `getDelta` innecesario.

### 15. `_streamAttached` como flag imperativo en DOM
`live.tsx:1976`: el ref de la preview de cámara web usa `v._streamAttached = true` como flag en el elemento DOM para evitar re-attachs. Es frágil — si el ref se llama múltiples veces con el mismo elemento, puede funcionar por casualidad. Mejor usar un `useRef<boolean>` separado.

### 16. `any` types innecesarios
`settings.ts:41`: `let storageModule: any = null` — puede tiparse como `typeof import('../services/storage') | null`. Hay algunos más en cámara refs que están justificados por la API de expo-camera.

---

## ✅ Lo que está bien

**Seguridad:**
- HttpOnly cookie para sesiones web — sin tokens en el bundle público ✅
- Passkey/WebAuthn registrado por el usuario, no hardcodeado ✅
- `appendBridgeToken` es no-op (la auth viaja por cookie), comentado explícitamente ✅
- Feature flags explícitos para rutas OpenClaw y notificaciones ✅
- Sin API keys ni secrets en el código fuente ni en `EXPO_PUBLIC_*` ✅
- Biometría local en native antes de acceder a la sesión ✅

**Arquitectura:**
- Separación limpia de servicios en `src/services/` ✅
- `NativeOrb.tsx` bien estructurado: shader SkSL en UI thread, `useDerivedValue` para uniforms ✅
- Audio buffering nativo con threshold + batch para playback sin gaps ✅
- VAD configurado con sensibilidad alta y silence padding corto ✅
- Context window compression configurada (`trigger_tokens: 80000`) ✅
- `decideNotificationHandling` limpio y testeable ✅
- Biometric gate en `index.tsx` falla abierto (no bloquea si no hay hardware) ✅

**Platform handling:**
- Branches web/native consistentes en mic, cámara, audio y auth ✅
- `NativeOrb` (Skia) vs `ThreeOrb` (WebGL) correctamente separados ✅
- `expo-file-system/legacy` con fallback a file para playback nativo ✅

---

## Prioridad de acción

| # | Issue | Esfuerzo | Impacto |
|---|-------|----------|---------|
| 1 | Refactorizar `live.tsx` | Alto | Alto (mantenibilidad) |
| 2 | Migrar `ScriptProcessorNode` → `AudioWorklet` | Medio | Alto (estabilidad audio) |
| 5 | Reconexión automática WebSocket | Bajo | Alto (UX mobile) |
| 3 | Eliminar `@simplewebauthn/server` del cliente | Bajo | Medio (bundle) |
| 4 | Auto-save settings | Bajo | Medio (UX) |
| 7 | No exponer args de tool calls en chat | Bajo | Medio (UX / OPSEC) |
| 6 | Eliminar Tailscale hardcodeada | Bajo | Bajo |
| 10 | Dispose Three.js en cleanup | Bajo | Bajo (memory) |
| 9 | Eliminar `@google/genai` del cliente | Mínimo | Bajo |
