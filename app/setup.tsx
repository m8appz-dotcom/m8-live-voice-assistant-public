import { View, Text, TouchableOpacity, StyleSheet } from 'react-native'
import { useRouter } from 'expo-router'

export default function Setup() {
  const router = useRouter()

  return (
    <View style={s.container}>
      <Text style={s.title}>m8live Setup</Text>
      <Text style={s.copy}>Backend bridge runs locally and exposes:</Text>
      <Text style={s.code}>POST /api/token</Text>
      <Text style={s.code}>POST /api/tools/openclaw-command</Text>
      <Text style={s.code}>POST /api/tools/openclaw-message</Text>
      <Text style={s.code}>WS /events</Text>
      <Text style={s.copy}>Set secrets in .env before running the bridge.</Text>

      <TouchableOpacity style={s.btn} onPress={() => router.replace('/live')}>
        <Text style={s.btnText}>Go to Live</Text>
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
