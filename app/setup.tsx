import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'

export default function Setup() {
  const router = useRouter()

  return (
    <View style={s.container}>
      <Text style={s.title}>Set up voice access</Text>
      <Text style={s.copy}>Sign in with a passkey to use your private voice connection.</Text>
      <Text style={s.copy}>Voice credentials stay on the server. Your conversation uses an English voice.</Text>

      <TouchableOpacity style={s.btn} onPress={() => router.replace('/live')}>
        <Text style={s.btnText}>Open conversation</Text>
      </TouchableOpacity>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a', padding: 24, justifyContent: 'center', gap: 10 },
  title: { color: '#fff', fontSize: 28, fontWeight: '800', marginBottom: 8 },
  copy: { color: 'rgba(255,255,255,0.75)', fontSize: 15 },
  code: { color: '#34d399', fontSize: 14, fontWeight: '700' },
  btn: { marginTop: 18, backgroundColor: '#2563eb', paddingVertical: 12, borderRadius: 12, alignItems: 'center' },
  btnText: { color: '#fff', fontWeight: '700', fontSize: 15 },
})
