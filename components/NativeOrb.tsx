/**
 * NativeOrb — Android/iOS 3D orb using React Native Skia
 * GPU shader with simplex noise, fresnel rim, particles, glow.
 * Animation runs entirely on the UI thread via useClock + useDerivedValue.
 */
import React, { useEffect } from 'react'
import {
  Canvas,
  Circle,
  Group,
  BlurMask,
  Shader,
  Skia,
  Points,
  vec,
  Fill,
  useClock,
} from '@shopify/react-native-skia'
import { useSharedValue, useDerivedValue, withTiming, Easing } from 'react-native-reanimated'

type SessionState = 'idle' | 'connecting' | 'ready' | 'listening' | 'responding' | 'error' | 'thinking' | 'searching'

interface NativeOrbProps {
  state: SessionState
  micLevel: number
  audioLevel?: number
  rotSpeed?: number
  distortion?: number
  size?: number
}

const DEFAULT_SIZE = 300
const RADIUS = 117

// ─── SkSL orb shader ───
const ORB_SHADER = Skia.RuntimeEffect.Make(`
  uniform float uTime;
  uniform float uNoiseAmp;
  uniform float uNoiseFreq;
  uniform float uFresnelPow;
  uniform float uCoreIntensity;
  uniform float uMicLevel;
  uniform vec3  uColor;
  uniform vec2  uCenter;
  uniform float uRadius;

  float hash(vec2 p) {
    p = fract(p * vec2(127.1, 311.7));
    p += dot(p, p + 43.21);
    return fract(p.x * p.y);
  }

  float smoothNoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i), hash(i + vec2(1,0)), u.x),
      mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float v = 0.0; float a = 0.5;
    for (int i = 0; i < 5; i++) {
      v += a * smoothNoise(p);
      p  = p * 2.13 + vec2(1.7, 9.2);
      a *= 0.5;
    }
    return v;
  }

  half4 main(vec2 fragCoord) {
    vec2 uv = (fragCoord - uCenter) / uRadius;
    float dist = length(uv);

    // Soft sphere edge — tighter falloff, no dark ring
    float edge = smoothstep(1.02, 0.85, dist);
    if (edge <= 0.001) return half4(0.0);

    // Animated fbm noise for surface distortion
    float mic = uMicLevel;
    vec2 noiseCoord = uv * uNoiseFreq + vec2(uTime * 0.28, uTime * 0.19);
    float n = fbm(noiseCoord) * 2.0 - 1.0;
    float amp = uNoiseAmp * (1.0 + mic * 2.5);
    float displaced = dist + n * amp;

    // Fresnel rim
    float fresnel = pow(clamp(displaced, 0.0, 1.0), uFresnelPow);

    // Core radial glow
    float coreDist = 1.0 - clamp(dist / 0.55, 0.0, 1.0);
    float core = pow(coreDist, 2.5) * uCoreIntensity * (1.0 + mic * 0.8);

    // Color
    float dispColor = smoothstep(-0.2, 0.2, n * amp);
    vec3 base   = mix(uColor * 0.3, uColor, dispColor);
    vec3 rim    = uColor * 1.7 + vec3(0.2);
    vec3 coreC  = mix(uColor * 1.5, vec3(1.0), 0.4);
    vec3 final  = base * (1.0 - fresnel * 0.6)
                + rim  * fresnel * 0.85
                + coreC * core;

    // Mic pulse brightening on rim
    final += uColor * fresnel * mic * 0.5;

    float alpha = (0.1 + fresnel * 0.72 + dispColor * 0.08 + core * 0.3) * edge;
    alpha = clamp(alpha, 0.0, 1.0);

    return half4(final * alpha, alpha);
  }
`)!

// State → target visual params
type Params = {
  noiseAmp: number; noiseFreq: number; fresnelPow: number
  coreIntensity: number; r: number; g: number; b: number
  glowBlur: number; scale: number
}

function getParams(state: SessionState): Params {
  switch (state) {
    case 'idle':       return { noiseAmp:0.025, noiseFreq:0.9,  fresnelPow:3.2, coreIntensity:0.12, r:0.27, g:0.27, b:0.36, glowBlur:5,  scale:1.0 }
    case 'connecting': return { noiseAmp:0.05,  noiseFreq:1.3,  fresnelPow:2.8, coreIntensity:0.25, r:0.97, g:0.45, b:0.09, glowBlur:10, scale:1.0 }
    case 'ready':      return { noiseAmp:0.035, noiseFreq:1.1,  fresnelPow:2.8, coreIntensity:0.18, r:0.55, g:0.58, b:0.72, glowBlur:7,  scale:1.0 }
    case 'listening':  return { noiseAmp:0.09,  noiseFreq:1.85, fresnelPow:2.1, coreIntensity:0.45, r:0.20, g:0.83, b:0.60, glowBlur:14, scale:1.01}
    case 'responding': return { noiseAmp:0.13,  noiseFreq:2.1,  fresnelPow:1.85,coreIntensity:0.80, r:0.30, g:0.65, b:1.0,  glowBlur:18, scale:1.02}
    case 'thinking':   return { noiseAmp:0.04,  noiseFreq:1.0,  fresnelPow:2.2, coreIntensity:0.30, r:0.55, g:0.36, b:0.96, glowBlur:12, scale:1.0 }
    case 'searching':  return { noiseAmp:0.08,  noiseFreq:1.6,  fresnelPow:2.5, coreIntensity:0.40, r:0.96, g:0.62, b:0.04, glowBlur:15, scale:1.0 }
    case 'error':      return { noiseAmp:0.045, noiseFreq:1.35, fresnelPow:2.5, coreIntensity:0.28, r:0.94, g:0.27, b:0.27, glowBlur:9,  scale:1.0 }
  }
}

// Particle orbit config (static)
const N_PARTICLES = 80
const P_ANGLES  = Array.from({length: N_PARTICLES}, (_, i) => (i / N_PARTICLES) * Math.PI * 2)
const P_RADII_FACTOR = Array.from({length: N_PARTICLES}, (_, i) => 1.16 + ((i * 137.5) % 100) / 100 * 0.38)
const P_PHASES  = Array.from({length: N_PARTICLES}, (_, i) => ((i * 73) % 100) / 100 * Math.PI * 2)
const P_SPEEDS  = Array.from({length: N_PARTICLES}, (_, i) => 0.22 + (i % 7) * 0.04)

export default function NativeOrb({ state, micLevel, audioLevel = 0, rotSpeed = 1.0, distortion = 1.3, size }: NativeOrbProps) {
  const canvasSize = size || DEFAULT_SIZE
  const center = canvasSize / 2
  const clock = useClock() // ms, runs on UI thread

  // Smooth shared values for all params — withTiming transitions on state change
  const noiseAmp      = useSharedValue(0.035)
  const noiseFreq     = useSharedValue(1.1)
  const fresnelPow    = useSharedValue(2.8)
  const coreIntensity = useSharedValue(0.18)
  const colorR        = useSharedValue(0.55)
  const colorG        = useSharedValue(0.58)
  const colorB        = useSharedValue(0.72)
  const glowBlur      = useSharedValue(7)
  const scaleVal      = useSharedValue(1.0)
  const micSmooth     = useSharedValue(0)
  const rotMult       = useSharedValue(1.0)

  // Animate params on state change
  useEffect(() => {
    const p = getParams(state)
    const cfg = { duration: 600, easing: Easing.out(Easing.cubic) }
    noiseAmp.value      = withTiming(p.noiseAmp,      cfg)
    noiseFreq.value     = withTiming(p.noiseFreq,     cfg)
    fresnelPow.value    = withTiming(p.fresnelPow,    cfg)
    coreIntensity.value = withTiming(p.coreIntensity, cfg)
    colorR.value        = withTiming(p.r, cfg)
    colorG.value        = withTiming(p.g, cfg)
    colorB.value        = withTiming(p.b, cfg)
    glowBlur.value      = withTiming(p.glowBlur, cfg)
    scaleVal.value      = withTiming(p.scale, { duration: 400 })
    rotMult.value       = withTiming(state === 'searching' ? 2.5 : 1.0, { duration: 600 })
  }, [state])

  // Smooth mic level + audio level
  const audioSmooth = useSharedValue(0)
  useEffect(() => {
    micSmooth.value = withTiming(micLevel, { duration: 80 })
  }, [micLevel])
  useEffect(() => {
    audioSmooth.value = withTiming(audioLevel, { duration: 60 })
  }, [audioLevel])

  // ─── Shader uniforms — all computed on UI thread ───
  const uniforms = useDerivedValue(() => {
    const t = (clock.value / 1000) * rotSpeed * rotMult.value
    // Combine mic input and audio output reactivity
    const combinedLevel = Math.max(micSmooth.value, audioSmooth.value)
    return {
      uTime:          t,
      uNoiseAmp:      noiseAmp.value * distortion,
      uNoiseFreq:     noiseFreq.value,
      uFresnelPow:    fresnelPow.value,
      uCoreIntensity: coreIntensity.value,
      uMicLevel:      combinedLevel,
      uColor:         [colorR.value, colorG.value, colorB.value] as [number, number, number],
      uCenter:        [center, center] as [number, number],
      uRadius:        RADIUS,
    }
  })

  // Orb scale transform
  const transform = useDerivedValue(() => [{ scale: scaleVal.value }])

  // Glow blur amount
  const glowAmount = useDerivedValue(() => glowBlur.value + Math.max(micSmooth.value, audioSmooth.value) * 8)

  // Particle points — animated on UI thread
  const particlePoints = useDerivedValue(() => {
    const t = (clock.value / 1000) * rotSpeed * rotMult.value
    const level = Math.max(micSmooth.value, audioSmooth.value)
    // listening/responding show more particles
    const visRatio = state === 'responding' || state === 'searching' ? 1.0
      : state === 'listening' || state === 'thinking' ? 0.55
      : state === 'ready' ? 0.2
      : state === 'connecting' ? 0.25
      : 0.08
    const count = Math.round(N_PARTICLES * visRatio)
    const pts: ReturnType<typeof vec>[] = []
    for (let i = 0; i < count; i++) {
      const angle = P_ANGLES[i] + t * P_SPEEDS[i] + P_PHASES[i]
      const r = RADIUS * P_RADII_FACTOR[i] * (1 + level * 0.15) + Math.sin(t * 0.4 + P_PHASES[i]) * 4
      pts.push(vec(center + Math.cos(angle) * r, center + Math.sin(angle) * r))
    }
    return pts
  })

  // Particle opacity
  const particleOpacity = useDerivedValue(() => {
    const level = Math.max(micSmooth.value, audioSmooth.value)
    const base = state === 'responding' ? 0.45 + level * 0.4
      : state === 'listening' ? 0.45 + level * 0.25
      : state === 'ready' ? 0.18
      : state === 'connecting' ? 0.22
      : 0.07
    return base
  })

  // Particle color (same as orb color, brighter)
  const particleColor = useDerivedValue(() =>
    `rgb(${Math.round(Math.min(1, colorR.value + 0.3) * 255)},${Math.round(Math.min(1, colorG.value + 0.3) * 255)},${Math.round(Math.min(1, colorB.value + 0.3) * 255)})`
  )

  // Wireframe ring opacity
  const wireOpacity = useDerivedValue(() => {
    const t = clock.value / 1000
    const base = state === 'responding' ? 0.12
      : state === 'listening' ? 0.09
      : state === 'idle' ? 0.03
      : 0.06
    return base + Math.sin(t * 0.7) * 0.015
  })

  // Glow ring color
  const glowColor = useDerivedValue(() =>
    `rgba(${Math.round(colorR.value * 255)},${Math.round(colorG.value * 255)},${Math.round(colorB.value * 255)},0.5)`
  )

  return (
    <Canvas style={{ width: canvasSize, height: canvasSize }}>
      {/* Background — transparent */}
      <Fill color="transparent" />

      {/* Outer glow halo — flush with orb edge, bleeds both ways */}
      <Circle cx={center} cy={center} r={RADIUS} color={glowColor}>
        <BlurMask blur={glowAmount} style="normal" />
      </Circle>

      {/* Main orb with SkSL shader */}
      <Group transform={transform} origin={vec(center, center)}>
        <Circle cx={center} cy={center} r={RADIUS}>
          <Shader source={ORB_SHADER} uniforms={uniforms} />
        </Circle>
      </Group>

      {/* Wireframe ring overlay — tight to orb */}
      <Circle
        cx={center} cy={center} r={RADIUS * 0.99}
        color="transparent"
        style="stroke"
        strokeWidth={0.5}
        opacity={wireOpacity}
      />

      {/* Orbital particles */}
      <Points
        points={particlePoints}
        mode="points"
        color={particleColor}
        strokeWidth={2.5}
        opacity={particleOpacity}
      />
    </Canvas>
  )
}
