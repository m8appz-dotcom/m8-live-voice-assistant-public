import React, { useEffect, useRef, useState } from 'react'
import { Platform, View, StyleSheet } from 'react-native'
import type { SessionState } from '../src/types/realtime'

const BAR_COUNT = 40

export default function AudioSpectrum({ state, audioLevel, micLevel, analyserRef }: {
  state: SessionState; audioLevel: number; micLevel: number;
  analyserRef: React.RefObject<AnalyserNode | null>
}) {
  const isWeb = Platform.OS === 'web'
  const [barHeights, setBarHeights] = useState<number[]>(() => new Array(BAR_COUNT).fill(5))
  const animRef = useRef<number>(0)
  const phaseRef = useRef<number[]>(
    Array.from({ length: BAR_COUNT }, () => Math.random() * Math.PI * 2)
  )

  useEffect(() => {
    let mounted = true
    const freqData = analyserRef?.current ? new Uint8Array(analyserRef.current.frequencyBinCount) : null

    const tick = () => {
      if (!mounted) return
      animRef.current = requestAnimationFrame(tick)
      const now = Date.now() / 1000
      const heights: number[] = []

      if (state === 'idle' || state === 'error') {
        // Disconnected: all bars at minimum
        for (let i = 0; i < BAR_COUNT; i++) heights.push(3 + Math.sin(now * 0.5 + phaseRef.current[i]) * 2)
      } else if (state === 'responding' && isWeb && analyserRef?.current && freqData) {
        // Web responding: real frequency data
        analyserRef.current.getByteFrequencyData(freqData)
        const binCount = freqData.length
        for (let i = 0; i < BAR_COUNT; i++) {
          const binIdx = Math.floor((i / BAR_COUNT) * binCount)
          const val = freqData[binIdx] / 255
          heights.push(5 + val * 85)
        }
      } else if (state === 'responding') {
        // Native responding: use audioLevel scalar to generate distribution
        const level = audioLevel
        for (let i = 0; i < BAR_COUNT; i++) {
          const wave = Math.sin(now * 4 + phaseRef.current[i] * 2) * 0.3 +
                       Math.sin(now * 7 + i * 0.4) * 0.2 + 0.5
          heights.push(5 + level * wave * 80)
        }
      } else if (state === 'listening') {
        // Listening: mic-driven
        const level = micLevel
        for (let i = 0; i < BAR_COUNT; i++) {
          const wave = Math.sin(now * 3 + phaseRef.current[i]) * 0.3 +
                       Math.cos(now * 5 + i * 0.3) * 0.2 + 0.5
          heights.push(5 + level * wave * 75)
        }
      } else {
        // Ready/connecting/thinking/searching: gentle ambient
        const amp = state === 'connecting' ? 8 : state === 'thinking' || state === 'searching' ? 12 : 10
        for (let i = 0; i < BAR_COUNT; i++) {
          const wave = Math.sin(now * 1.2 + phaseRef.current[i]) * 0.5 +
                       Math.sin(now * 2.1 + i * 0.2) * 0.3 + 0.5
          heights.push(5 + wave * amp)
        }
      }

      setBarHeights(heights)
    }
    tick()
    return () => { mounted = false; if (animRef.current) cancelAnimationFrame(animRef.current) }
  }, [state, audioLevel, micLevel, isWeb])

  if (isWeb) {
    // Web: use real divs with linear-gradient and box-shadow
    return (
      <View style={specS.container}>
        {/* @ts-ignore web div wrapper */}
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          gap: '4px', height: '100%', width: '100%', paddingLeft: 0, paddingRight: 0,
        }}>
          {barHeights.map((h, i) => (
            // @ts-ignore web div
            <div key={i} style={{
              flex: 1, minWidth: 2, height: `${h}%`,
              background: 'linear-gradient(to top, #00ffff, #00fc97)',
              boxShadow: '0 0 15px rgba(0, 255, 255, 0.3)',
              borderRadius: 1,
              transition: 'height 80ms ease-out',
            }} />
          ))}
        </div>
      </View>
    )
  }

  // Native: RN Views with gradient approximation
  return (
    <View style={specS.container}>
      <View style={specS.barRow}>
        {barHeights.map((h, i) => (
          <View key={i} style={[specS.bar, { height: `${h}%` as any }]} />
        ))}
      </View>
    </View>
  )
}

const specS = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  barRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    height: 530,
    width: '100%',
  },
  bar: {
    flex: 1,
    minWidth: 2,
    backgroundColor: '#00e5c7', // midpoint of cyan-green gradient (native fallback)
    borderRadius: 1,
    // Native shadow approximation
    shadowColor: '#00ffff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.3,
    shadowRadius: 15,
    elevation: 4,
  },
})