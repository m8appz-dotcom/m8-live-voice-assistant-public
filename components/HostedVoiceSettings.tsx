import { useEffect, useState } from 'react'
import { View, Text, TouchableOpacity, ScrollView, StyleSheet, Linking } from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { workspaceStatus, type WorkspaceStatus } from '../src/services/hostedWorkspace'
import { clearBridgeSession } from '../src/services/bridgeSession'
import { registerBridgePasskey } from '../src/services/passkey'

// Reuses the original settings screen's spacing, surfaces, type and accent.
export default function HostedVoiceSettings() {
  const router = useRouter(), insets = useSafeAreaInsets()
  const [access, setAccess] = useState<WorkspaceStatus | null>(null)
  const [busy, setBusy] = useState(false), [message, setMessage] = useState('')
  useEffect(() => { void workspaceStatus().then(setAccess).catch(() => setMessage('Access could not be checked. Return to Live and try again.')) }, [])
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setMessage('')
    try { await action() } catch { setMessage('The action did not finish. Your existing access and saved work are still available.') }
    finally { setBusy(false) }
  }
  return <View style={[s.container, { paddingTop: Math.max(insets.top, 16) }]}>
    <View style={s.header}>
      <TouchableOpacity accessibilityRole="button" onPress={() => router.replace('/live')}><Text style={s.backBtn}>Back</Text></TouchableOpacity>
      <Text style={s.title}>Settings</Text><View style={{ width: 40 }} />
    </View>
    <ScrollView contentContainerStyle={s.scrollContent}>
      <Text style={s.sectionTitle}>Voice</Text>
      <View style={s.card}><Text style={s.cardTitle}>English conversation</Text><Text style={s.cardDesc}>Use the microphone or type in Chat. The speaker button mutes spoken replies.</Text></View>
      <Text style={s.sectionTitle}>Access and recovery</Text>
      <View style={s.card}>
        <Text style={s.cardTitle}>{access?.signedIn ? 'Signed in with a passkey' : 'Sign in from Live'}</Text>
        <Text style={s.cardDesc}>Keep a second passkey on another authenticator so you retain access if one is lost.</Text>
        {access?.signedIn && !access.recoveryOnly && <TouchableOpacity accessibilityRole="button" disabled={busy} style={s.smallBtn} onPress={() => void run(async () => { await registerBridgePasskey(); setMessage('Recovery passkey added.') })}><Text style={s.smallBtnText}>{busy ? 'Waiting for confirmation…' : 'Add recovery passkey'}</Text></TouchableOpacity>}
        <TouchableOpacity accessibilityRole="link" style={s.smallBtnGhost} onPress={() => void Linking.openURL('/workspace/')}><Text style={s.smallBtnGhostText}>Open saved workspace</Text></TouchableOpacity>
        <Text style={s.cardDesc}>Your previous private copy remains available here.</Text>
        {access?.signedIn && <TouchableOpacity accessibilityRole="button" disabled={busy} style={s.smallBtnGhost} onPress={() => void run(async () => { await clearBridgeSession(); window.location.replace('/live') })}><Text style={s.smallBtnGhostText}>Sign out</Text></TouchableOpacity>}
        {!!message && <Text accessibilityLiveRegion="polite" style={s.cardDesc}>{message}</Text>}
      </View>
    </ScrollView>
  </View>
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d0d0d' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12 },
  backBtn: { color: '#6b7280', fontSize: 15, fontWeight: '500' },
  title: { color: '#e8ecf0', fontSize: 17, fontWeight: '700', fontFamily: 'monospace' },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40, gap: 8 },
  sectionTitle: { color: '#e8ecf0', fontSize: 13, fontWeight: '700', marginTop: 20, letterSpacing: 1, textTransform: 'uppercase' },
  card: { backgroundColor: '#111111', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', gap: 10 },
  cardTitle: { color: '#e8ecf0', fontSize: 15, fontWeight: '700' },
  cardDesc: { color: 'rgba(255,255,255,0.72)', fontSize: 12, lineHeight: 18 },
  smallBtn: { backgroundColor: '#00d4ff', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 9, alignSelf: 'flex-start' },
  smallBtnText: { color: '#001018', fontSize: 12, fontWeight: '800' },
  smallBtnGhost: { backgroundColor: '#1a1a1a', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 9, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)', alignSelf: 'flex-start' },
  smallBtnGhostText: { color: '#cbd5e1', fontSize: 12, fontWeight: '700' },
})
