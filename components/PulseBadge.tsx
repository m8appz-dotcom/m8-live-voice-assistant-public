import React, { useEffect, useRef } from 'react'
import { Animated as RNAnimated, Text } from 'react-native'

export default function PulseBadge({ label, color }: { label: string; color: string }) {
  const opacity = useRef(new RNAnimated.Value(1)).current
  useEffect(() => {
    const anim = RNAnimated.loop(
      RNAnimated.sequence([
        RNAnimated.timing(opacity, { toValue: 0.4, duration: 600, useNativeDriver: true }),
        RNAnimated.timing(opacity, { toValue: 1, duration: 600, useNativeDriver: true }),
      ])
    )
    anim.start()
    return () => anim.stop()
  }, [])
  return (
    <RNAnimated.View style={{
      opacity,
      backgroundColor: color,
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderRadius: 16,
      marginTop: 10,
    }}>
      <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 }}>{label}</Text>
    </RNAnimated.View>
  )
}