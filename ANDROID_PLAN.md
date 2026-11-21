# M8 Live — Android Native Port Plan

> Objetivo: versión Android nativa con paridad completa de features + orbe 3D idéntica a web.

---

## 1. Análisis del estado actual

### Lo que existe (web-first)
- Expo app con `Platform.OS === 'web'` como path principal
- Orbe 3D: `ThreeOrb` via `three.js` sobre WebGL canvas (solo web)
- Audio: `AudioContext` API + `ScriptProcessorNode` (Web Audio API, no funciona en native)
- Mic streaming: `getUserMedia` → PCM downsampled → WebSocket (solo web)
- Playback: PCM16 → `AudioBuffer` → `AudioContext` (solo web)
- Video: `getDisplayMedia` / `getUserMedia` (solo web)
- `NativeOrb`: existe un fallback nativo (simple ring) — **nunca se terminó**

### Lo que falta en Android
1. Orbe 3D animada con shaders GLSL reactiva a audio
2. Mic streaming PCM16 a 16kHz hacia Gemini Live WebSocket
3. Playback de audio PCM16 a 24kHz desde Gemini
4. Camera feed → frames JPEG → WebSocket
5. Análisis de nivel de micrófono (para que la orbe reaccione)

---

## 2. Stack Recomendado

### Rendering de la Orbe
**Decisión: `@shopify/react-native-skia` + shaders personalizados**

Opciones evaluadas:

| Stack | Pros | Contras |
|-------|------|---------|
| `react-native-skia` con shaders | GPU-accelerated, API madura, misma dependencia ya instalada | Shaders en formato Skia (SkSL), no GLSL — hay que reescribir |
| `expo-gl` + three.js | Reutiliza el código GLSL actual casi 1:1 | `expo-gl` deprecado en Expo SDK 55+, sin futuro |
| `react-native-wgpu` | Futuro tech, WebGPU nativo | Experimental, sin soporte producción |
| Reanimated worklets + Skia | Animaciones en UI thread, baja latencia | Sin shaders complejos, limitado para orbe orgánica |

**Ganador: `react-native-skia` con SkSL shaders**
- Ya está instalado (`@shopify/react-native-skia: 2.4.18`)
- Shader API de Skia permite ruido simplex y fresnel directamente
- Se ejecuta en el GPU thread, no bloquea JS
- Permite `useSharedValue` de Reanimated para reactivity con el mic sin pasar por JS bridge

### Audio (Mic + Playback)
**Decisión: `@siteed/expo-audio-studio`**

Opciones evaluadas:

| Stack | Pros | Contras |
|-------|------|---------|
| `expo-av` | Oficial Expo | No da acceso a raw PCM streaming, solo archivo |
| `react-native-audio-record` | Da PCM chunks | Abandonado, sin soporte ARM64 moderno |
| `@siteed/expo-audio-studio` | PCM16 streaming, FFT/RMS, sample rate config | Requiere config nativa |
| `react-native-live-audio-stream` | Similar | Poco mantenido |

**Ganador: `@siteed/expo-audio-studio`**
- Provee `startRecording` con chunks PCM16 vía callbacks
- Configurable a 16kHz/mono exactamente como requiere Gemini Live
- Tiene `AudioAnalysis` para nivel RMS (necesario para la orbe)
- Mantenido activamente, compatible con Expo SDK 55

**Playback PCM: `react-native-sound` o Web Audio via `expo-av` workaround**

Para reproducir PCM16 raw desde Gemini, la opción más práctica:
- Escribir PCM chunks a un archivo temporal `.pcm` → reproducir con `expo-av`
- O usar `react-native-track-player` con stream desde un servidor local
- **Mejor opción:** `@siteed/expo-audio-studio` también tiene `AudioPlayer` con buffer directo

### Cámara
**Decisión: `expo-camera` (ya instalado)**
- `expo-camera` v55 soporta `onCameraReady` + captura de frames como JPEG base64
- Usar `takePictureAsync({ base64: true, quality: 0.6 })` en intervalo de 1fps
- Ya está en `package.json`

### WebSocket
- `WebSocket` global disponible en React Native (Hermes engine)
- Mismo código de WS que en web, sin cambios

---

## 3. Plan de Implementación

### Fase 1: NativeOrb con Skia Shaders
**Tiempo estimado: 1-2 días**

Crear `components/NativeOrb.tsx` usando `@shopify/react-native-skia`:

```tsx
import { Canvas, Shader, makeShader, useClock } from '@shopify/react-native-skia'
import { useSharedValue, useDerivedValue } from 'react-native-reanimated'
```

El shader SkSL para la orbe (equivalente funcional del GLSL actual):

```glsl
// SkSL — noise + fresnel + displacement
uniform float uTime;
uniform float uNoiseAmp;
uniform float uMicLevel;
uniform vec3 uColor;

// Simplex noise en SkSL (mismo algoritmo que el GLSL actual)
// ... (portar función snoise a SkSL)

half4 main(vec2 fragCoord) {
  vec2 uv = (fragCoord - vec2(200.0)) / 200.0;
  float dist = length(uv);
  
  // Ruido simplex 2D con desplazamiento
  float noise = snoise(vec3(uv * uNoiseFreq, uTime * uNoiseSpeed));
  float displaced = dist + noise * uNoiseAmp * (1.0 + uMicLevel * 3.0);
  
  // Fresnel rim
  float fresnel = pow(displaced, uFresnelPower);
  
  // Alpha y color final
  float alpha = smoothstep(1.1, 0.7, displaced) * (0.3 + fresnel * 0.7);
  vec3 col = mix(uColor * 0.4, uColor * 1.5, fresnel);
  
  return vec4(col * alpha, alpha);
}
```

Estructura del componente:

```tsx
function NativeOrb({ state, micLevel }: { state: SessionState; micLevel: number }) {
  const clock = useClock()                          // tiempo en UI thread
  const mic = useSharedValue(0)
  
  // Smooth mic level en worklet (sin pasar por JS bridge)
  const smoothMic = useDerivedValue(() => {
    return mic.value * 0.15 + micLevel * 0.85
  })
  
  const uniforms = useDerivedValue(() => ({
    uTime: clock.value / 1000,
    uMicLevel: smoothMic.value,
    uNoiseAmp: state === 'listening' ? 0.08 + smoothMic.value * 0.25 : 0.06,
    uColor: stateToColor(state),
    // ... resto de uniforms
  }))
  
  return (
    <Canvas style={{ width: 360, height: 360 }}>
      <Circle cx={180} cy={180} r={140}>
        <Shader source={orbShader} uniforms={uniforms} />
      </Circle>
      {/* Wireframe overlay con Path + strokeWidth */}
      {/* Particles con Points */}
    </Canvas>
  )
}
```

**Partículas y wireframe:** usar `<Path>` y `<Points>` de Skia, actualizados via `useDerivedValue` desde el clock en el UI thread.

---

### Fase 2: Audio Nativo (Mic → Gemini)
**Tiempo estimado: 0.5 días**

Instalar:
```bash
npx expo install @siteed/expo-audio-studio
```

Implementación en `live.tsx`:

```tsx
import { AudioRecorder } from '@siteed/expo-audio-studio'

const startMicNative = async () => {
  await AudioRecorder.start({
    sampleRate: 16000,
    channels: 1,
    encoding: 'pcm_16bit',
    onAudioData: (chunk: { data: string; mimeType: string }) => {
      // chunk.data ya es base64 de PCM16 a 16kHz
      wsRef.current?.send(JSON.stringify({
        realtimeInput: { audio: { data: chunk.data, mimeType: 'audio/pcm;rate=16000' } }
      }))
    },
    onAudioAnalysis: (analysis: { rms: number }) => {
      setMicLevel(analysis.rms) // para la orbe
    },
  })
  setMicOn(true)
  setState('listening')
}

const stopMicNative = async () => {
  await AudioRecorder.stop()
  wsRef.current?.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }))
  setMicOn(false)
}
```

---

### Fase 3: Playback PCM Nativo (Gemini → Speaker)
**Tiempo estimado: 1 día**

El audio de Gemini llega como chunks PCM16 a 24kHz base64. En web usamos `AudioContext`. En native:

**Opción A — Buffer nativo directo (recomendado):**
```bash
npx expo install @siteed/expo-audio-studio
```
`AudioPlayer` de este paquete acepta PCM buffers directamente:

```tsx
import { AudioPlayer } from '@siteed/expo-audio-studio'

const playAudioNative = async (b64: string) => {
  await AudioPlayer.playPCM({
    data: b64,
    sampleRate: 24000,
    channels: 1,
    encoding: 'pcm_16bit',
  })
}
```

**Opción B — Fallback via archivo temporal:**
```tsx
import * as FileSystem from 'expo-file-system'
import { Audio } from 'expo-av'

const playAudioNative = async (b64: string) => {
  const path = FileSystem.cacheDirectory + 'chunk.pcm'
  await FileSystem.writeAsStringAsync(path, b64, { encoding: 'base64' })
  const { sound } = await Audio.Sound.createAsync({ uri: path })
  await sound.playAsync()
}
```

Nota: queuing de chunks para evitar gaps (mismo patrón `nextStartRef` del web).

---

### Fase 4: Cámara Nativa
**Tiempo estimado: 0.5 días**

`expo-camera` ya está instalado. Usar `ref.current.takePictureAsync()` en intervalo:

```tsx
import { CameraView, useCameraPermissions } from 'expo-camera'

const cameraRef = useRef<CameraView>(null)

const startCameraNative = () => {
  frameIntervalRef.current = setInterval(async () => {
    if (!cameraRef.current || !wsRef.current) return
    try {
      const photo = await cameraRef.current.takePictureAsync({
        base64: true, quality: 0.5, skipProcessing: true
      })
      wsRef.current.send(JSON.stringify({
        realtimeInput: { video: { data: photo.base64, mimeType: 'image/jpeg' } }
      }))
    } catch {}
  }, 1000)
}
```

Mostrar preview en un `<CameraView>` pequeño en esquina (mismo lugar que en web).

---

### Fase 5: Platform.OS branching en live.tsx
**Tiempo estimado: 0.5 días**

Refactor mínimo: condicionar `startMic`, `stopMic`, `playAudio`, `startVideo` por plataforma:

```tsx
const startMic = Platform.OS === 'web' ? startMicWeb : startMicNative
const stopMic  = Platform.OS === 'web' ? stopMicWeb  : stopMicNative
const playAudio = Platform.OS === 'web' ? playAudioWeb : playAudioNative
```

El JSX del orbe:
```tsx
{Platform.OS === 'web' ? (
  <ThreeOrb state={state} micLevel={micLevel} ... />
) : (
  <NativeOrb state={state} micLevel={micLevel} />
)}
```

---

## 4. Dependencias a Instalar

```bash
# Audio (mic streaming + PCM playback + RMS analysis)
npx expo install @siteed/expo-audio-studio

# (ya instaladas, confirmar versiones)
# @shopify/react-native-skia: 2.4.18  ✓
# react-native-reanimated: ^4.2.2     ✓
# expo-camera: ~55.0.9                ✓
# expo-file-system: ^55.0.10          ✓
```

Verificar que `app.json` tenga los permisos:
```json
{
  "expo": {
    "android": {
      "permissions": [
        "RECORD_AUDIO",
        "CAMERA",
        "INTERNET"
      ]
    }
  }
}
```

---

## 5. Build Android

### Ruta corta (requerida por Skia + NDK path length limit en Windows)
```powershell
# Copiar proyecto a ruta corta antes de compilar
robocopy "C:\Users\M8\Projects\Gemini Live" "C:\dev\m8live" /E /XD node_modules .git android\build

cd C:\dev\m8live
npm install

# Build debug APK
cd android
.\gradlew assembleDebug

# Build release APK
.\gradlew assembleRelease

# Install en dispositivo conectado
adb install app\build\outputs\apk\debug\app-debug.apk
```

### Alternativa EAS Build (cloud)
```bash
npm install -g eas-cli
eas build --platform android --profile preview
```

---

## 6. Arquitectura Final por Plataforma

```
┌─────────────────────────────────────────────────┐
│                  live.tsx (shared)               │
│  WebSocket ←→ Gemini Live API                    │
│  Tool calls ←→ proxy.mjs ←→ OpenClaw bridge     │
│  Chat state, session state, draft, controls      │
└────────────────┬───────────────┬────────────────┘
                 │               │
    ┌────────────▼──┐     ┌──────▼──────────────┐
    │   WEB path    │     │   NATIVE path        │
    │               │     │                      │
    │  ThreeOrb     │     │  NativeOrb (Skia)    │
    │  (three.js +  │     │  (SkSL shaders +     │
    │   GLSL)       │     │   Reanimated worklet) │
    │               │     │                      │
    │  Web Audio    │     │  expo-audio-studio   │
    │  API (mic +   │     │  (PCM16 mic +        │
    │  playback)    │     │   PCM16 playback)    │
    │               │     │                      │
    │  getUserMedia │     │  expo-camera         │
    │  (camera +    │     │  (camera frames)     │
    │  screen)      │     │  [no screen share]   │
    └───────────────┘     └──────────────────────┘
```

---

## 7. Limitaciones Android vs Web

| Feature | Web | Android |
|---------|-----|---------|
| Orbe 3D GLSL | three.js (idéntico al diseño) | Skia SkSL (visualmente equivalente) |
| Mic streaming | getUserMedia | expo-audio-studio |
| PCM playback | AudioContext | expo-audio-studio |
| Camera | getUserMedia | expo-camera |
| Screen share | getDisplayMedia | **No disponible** (limitación OS) |
| File attach | input[type=file] | expo-document-picker |

---

## 8. Orden de Ejecución Sugerido

1. `npm install @siteed/expo-audio-studio` + permisos en `app.json`
2. Build Android vacío para verificar que Skia sigue compilando (`gradlew assembleDebug` desde `C:\dev\m8live`)
3. Implementar `NativeOrb` con shader básico (sin reactivity) → build → ver orbe en device
4. Añadir reactivity de mic al shader via `useSharedValue`
5. Implementar `startMicNative` / `stopMicNative` → test de voz a Gemini
6. Implementar `playAudioNative` → test de respuesta de audio
7. Implementar cámara nativa
8. Test end-to-end en dispositivo físico
9. Build release APK

---

## 9. Notas Críticas

- **Windows long path:** Siempre hacer el build desde `C:\dev\m8live` no desde `C:\Users\M8\Projects\Gemini Live`
- **Hermes:** React Native 0.83 usa Hermes por defecto — WebSocket nativo funciona sin polyfills
- **Audio permissions Android 13+:** `RECORD_AUDIO` requiere solicitud en runtime, no solo en manifest
- **Skia version lock:** No actualizar `@shopify/react-native-skia` sin verificar compatibilidad con Expo SDK 55
- **Gemini Live model:** `gemini-2.5-flash-native-audio-latest` — mismo en web y native, el WebSocket es idéntico
