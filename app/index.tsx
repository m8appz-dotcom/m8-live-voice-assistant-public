import { useEffect, useState } from 'react'
import { View, Text, StyleSheet, Pressable, Platform } from 'react-native'
import { useRouter } from 'expo-router'

export default function Home() {
  const router = useRouter()
  const [status, setStatus] = useState<'checking' | 'authed' | 'failed' | 'unavailable'>('checking')

  useEffect(() => {
    authenticate()
  }, [])

  async function authenticate() {
    if (Platform.OS === 'web') {
      router.replace('/live')
      return
    }
    try {
      const LocalAuth = await import('expo-local-authentication')
      const hasHardware = await LocalAuth.hasHardwareAsync()
      const isEnrolled = await LocalAuth.isEnrolledAsync()

      if (!hasHardware || !isEnrolled) {
        // No biometrics available — go straight in
        router.replace('/live')
        return
      }

      const result = await LocalAuth.authenticateAsync({
        promptMessage: 'm8live',
        fallbackLabel: 'Use passcode',
        disableDeviceFallback: false,
      })

      if (result.success) {
        setStatus('authed')
        router.replace('/live')
      } else {
        setStatus('failed')
      }
    } catch {
      // If anything fails, go in anyway
      router.replace('/live')
    }
  }

  if (status === 'failed') {
    return (
      <View style={s.root}>
        <Text style={s.icon}>⬡</Text>
        <Text style={s.label}>Authentication required</Text>
        <Pressable style={s.btn} onPress={() => { setStatus('checking'); authenticate() }}>
          <Text style={s.btnText}>Try again</Text>
        </Pressable>
      </View>
    )
  }

  return <View style={s.root} />
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0d0d0d', alignItems: 'center', justifyContent: 'center' },
  icon: { fontSize: 48, color: '#00d4ff', marginBottom: 24 },
  label: { color: '#6b7280', fontSize: 14, letterSpacing: 1, marginBottom: 32, fontFamily: 'monospace' },
  btn: { backgroundColor: '#1a2a40', paddingHorizontal: 24, paddingVertical: 12, borderRadius: 8 },
  btnText: { color: '#00d4ff', fontWeight: '700', letterSpacing: 1 },
})
