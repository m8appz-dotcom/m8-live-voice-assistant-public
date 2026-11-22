import { useCallback, useEffect, useState } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView, Linking, NativeModules, PermissionsAndroid, Platform,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useSettings, saveSettings } from '../src/stores/settings'
import { getDeviceRegistrationHeaders, getBridgeHeaders, getToolBase } from '../src/services/appConfig'

import { hostedWorkspace } from '../src/services/hostedWorkspace'
import HostedVoiceSettings from '../components/HostedVoiceSettings'

export default function Settings() { return hostedWorkspace ? <HostedVoiceSettings /> : <OriginalSettings /> }

const AndroidDeviceControl = NativeModules.M8DeviceControl

// Gemini Live built-in voices (2.5 Flash native audio)
const VOICES = [
  { id: 'Zephyr', name: 'Zephyr', desc: 'Bright' },
  { id: 'Puck', name: 'Puck', desc: 'Upbeat' },
  { id: 'Charon', name: 'Charon', desc: 'Informative' },
  { id: 'Kore', name: 'Kore', desc: 'Firm' },
  { id: 'Fenrir', name: 'Fenrir', desc: 'Excitable' },
  { id: 'Aoede', name: 'Aoede', desc: 'Breezy' },
  { id: 'Leda', name: 'Leda', desc: 'Youthful' },
  { id: 'Orus', name: 'Orus', desc: 'Firm' },
  { id: 'Lyra', name: 'Lyra', desc: 'Warm' },
  { id: 'Callirrhoe', name: 'Callirrhoe', desc: 'Easy-going' },
]

const COLORS = [
  { name: 'Cyan', orb: '#00d4ff', accent: '#67E8F9' },
  { name: 'Blue', orb: '#4DA6FF', accent: '#88CCFF' },
  { name: 'Green', orb: '#34D399', accent: '#6EE7B7' },
  { name: 'Purple', orb: '#A78BFA', accent: '#C4B5FD' },
  { name: 'Orange', orb: '#FB923C', accent: '#FDBA74' },
  { name: 'Pink', orb: '#F472B6', accent: '#F9A8D4' },
]

type SourceStatus = Record<string, any>

function statusText(value: unknown) {
  if (value === true) return 'ON'
  if (value === false) return 'OFF'
  if (value === undefined || value === null || value === '') return 'UNKNOWN'
  return String(value).toUpperCase()
}

async function fetchJson(path: string): Promise<any> {
  const isWeb = Platform.OS === 'web'
  const res = await fetch(`${getToolBase(isWeb)}${path}`, {
    method: 'GET',
    credentials: isWeb ? 'same-origin' : undefined,
    headers: {
      ...getBridgeHeaders(),
      ...(!isWeb ? getDeviceRegistrationHeaders() : {}),
    },
  })
  return await res.json().catch(() => ({}))
}

function OriginalSettings() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const settings = useSettings()
  const [androidStatus, setAndroidStatus] = useState<Record<string, any> | null>(null)
  const [sources, setSources] = useState<SourceStatus | null>(null)
  const [busy, setBusy] = useState('')
  const [voiceProvider, setVoiceProvider] = useState<string | null>(null)

  const refreshStatus = useCallback(async () => {
    setBusy('refresh')
    try {
      const [capabilities, nativeStatus, voiceHealth] = await Promise.all([
        fetchJson('/api/messages/capabilities').catch((error) => ({ ok: false, error: String(error?.message || error) })),
        Platform.OS === 'android' && AndroidDeviceControl?.status
          ? AndroidDeviceControl.status().catch((error: Error) => ({ ok: false, error: String(error?.message || error) }))
          : Promise.resolve({ ok: Platform.OS !== 'android', platform: Platform.OS, nativeControl: false }),
        fetchJson('/api/health').catch(() => null),
      ])
      setSources(capabilities?.sources || capabilities)
      setAndroidStatus(nativeStatus)
      setVoiceProvider(voiceHealth?.provider || null)
    } finally {
      setBusy('')
    }
  }, [])

  useEffect(() => { void refreshStatus() }, [refreshStatus])

  const handleSave = async () => {
    await saveSettings()
    router.back()
  }

  const openAndroidSettings = async (target: 'accessibility' | 'notifications' | 'app') => {
    if (Platform.OS !== 'android' || !AndroidDeviceControl) return
    if (target === 'accessibility') await AndroidDeviceControl.openAccessibilitySettings()
    else if (target === 'notifications') await AndroidDeviceControl.openNotificationListenerSettings()
    else await AndroidDeviceControl.openAppDetailsSettings()
  }

  const requestSms = async () => {
    if (Platform.OS !== 'android') return
    await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_SMS, {
      title: 'Allow SMS reading',
      message: 'M8 Live can read SMS only when Boss explicitly asks.',
      buttonPositive: 'Allow',
      buttonNegative: 'Deny',
    })
    await refreshStatus()
  }

  const connectGmail = async () => {
    setBusy('gmail')
    try {
      const result = await fetchJson('/api/messages/gmail/auth/start')
      const authUrl = result?.authUrl || result?.url
      if (authUrl) await Linking.openURL(authUrl)
      setSources((current) => ({ ...(current || {}), gmail: result }))
    } finally {
      setBusy('')
    }
  }

  const refreshTelegram = async () => {
    setBusy('telegram')
    try {
      const result = await fetchJson('/api/messages/telegram/status')
      setSources((current) => ({ ...(current || {}), telegram: result }))
    } finally {
      setBusy('')
    }
  }

  const gmail = sources?.gmail || {}
  const telegram = sources?.telegram || {}

  return (
    <View style={[s.container, { paddingTop: Math.max(insets.top, 16) + 8 }]}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => router.back()} activeOpacity={0.7}>
          <Text style={s.backBtn}>Cancel</Text>
        </TouchableOpacity>
        <Text style={s.title}>Settings</Text>
        <TouchableOpacity onPress={handleSave} activeOpacity={0.7}>
          <Text style={s.saveBtn}>Save</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>
        <Text style={s.sectionTitle}>Connectors</Text>
        <Text style={s.sectionDesc}>Full-read sources are explicit and private. Message bodies are read only when you ask.</Text>

        <View style={s.card}>
          <View style={s.rowHead}>
            <View>
              <Text style={s.cardTitle}>Gmail</Text>
              <Text style={s.cardDesc}>Gmail API readonly</Text>
            </View>
            <Text style={[s.statusPill, gmail.connected && s.statusOn]}>{statusText(gmail.connected || gmail.ok)}</Text>
          </View>
          {!!gmail.error && <Text style={s.errorText}>{gmail.error}</Text>}
          <View style={s.actionRow}>
            <TouchableOpacity style={s.smallBtn} onPress={connectGmail} disabled={busy === 'gmail'} activeOpacity={0.75}>
              <Text style={s.smallBtnText}>{busy === 'gmail' ? 'Opening...' : 'Connect Gmail'}</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.smallBtnGhost} onPress={refreshStatus} activeOpacity={0.75}>
              <Text style={s.smallBtnGhostText}>Refresh</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={s.card}>
          <View style={s.rowHead}>
            <View>
              <Text style={s.cardTitle}>Telegram</Text>
              <Text style={s.cardDesc}>TDLib bridge login/status</Text>
            </View>
            <Text style={[s.statusPill, telegram.ok && s.statusOn]}>{statusText(telegram.connected || telegram.ok)}</Text>
          </View>
          {!!telegram.error && <Text style={s.errorText}>{telegram.error}</Text>}
          <View style={s.actionRow}>
            <TouchableOpacity style={s.smallBtn} onPress={refreshTelegram} disabled={busy === 'telegram'} activeOpacity={0.75}>
              <Text style={s.smallBtnText}>{busy === 'telegram' ? 'Checking...' : 'Check Telegram'}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <Text style={s.sectionTitle}>Android Control</Text>
        <Text style={s.sectionDesc}>Enable these on the phone before expecting full voice control.</Text>
        <View style={s.card}>
          <SettingStatus label="Accessibility" value={androidStatus?.accessibilityEnabled} />
          <SettingStatus label="Notifications" value={androidStatus?.notificationListenerEnabled} />
          <SettingStatus label="SMS read" value={androidStatus?.smsReadGranted} />
          <View style={s.actionRowWrap}>
            <TouchableOpacity style={s.smallBtn} onPress={() => openAndroidSettings('accessibility')} activeOpacity={0.75}>
              <Text style={s.smallBtnText}>Accessibility</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.smallBtn} onPress={() => openAndroidSettings('notifications')} activeOpacity={0.75}>
              <Text style={s.smallBtnText}>Notifications</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.smallBtn} onPress={requestSms} activeOpacity={0.75}>
              <Text style={s.smallBtnText}>Allow SMS</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.smallBtnGhost} onPress={() => openAndroidSettings('app')} activeOpacity={0.75}>
              <Text style={s.smallBtnGhostText}>App permissions</Text>
            </TouchableOpacity>
          </View>
          <TouchableOpacity style={s.refreshBtn} onPress={refreshStatus} activeOpacity={0.75}>
            <Text style={s.refreshText}>{busy === 'refresh' ? 'Refreshing...' : 'Refresh status'}</Text>
          </TouchableOpacity>
        </View>

        <Text style={s.sectionTitle}>Voice</Text>
        <Text style={s.sectionDesc}>{voiceProvider === 'spark'
          ? 'Aria · English (US). This voice is set for all conversations.'
          : voiceProvider === 'gemini'
            ? 'Choose a voice for your next conversation.'
            : 'Connect to the voice service to view its voice settings.'}</Text>
        {voiceProvider === 'gemini' && VOICES.map(v => (
          <TouchableOpacity
            key={v.id}
            style={[s.voiceRow, settings.voiceId === v.id && s.voiceRowActive]}
            onPress={() => settings.set({ voiceId: v.id, voiceName: v.name })}
            activeOpacity={0.7}
          >
            <View style={s.voiceInfo}>
              <Text style={s.voiceName}>{v.name}</Text>
              <Text style={s.voiceDesc}>{v.desc}</Text>
            </View>
            {settings.voiceId === v.id && <Text style={s.checkmark}>✓</Text>}
          </TouchableOpacity>
        ))}

        <Text style={s.sectionTitle}>Orb Color</Text>
        <View style={s.colorRow}>
          {COLORS.map(c => (
            <TouchableOpacity
              key={c.orb}
              style={[s.colorSwatch, { backgroundColor: c.orb },
                settings.orbColor === c.orb && s.colorSwatchActive]}
              onPress={() => settings.set({ orbColor: c.orb, accentColor: c.accent })}
              activeOpacity={0.7}
            >
              {settings.orbColor === c.orb && <Text style={s.colorCheck}>✓</Text>}
            </TouchableOpacity>
          ))}
        </View>

        <TouchableOpacity style={s.resetBtn} onPress={settings.reset} activeOpacity={0.7}>
          <Text style={s.resetText}>Reset to Defaults</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
    </View>
  )
}

function SettingStatus({ label, value }: { label: string; value: unknown }) {
  const on = value === true
  return (
    <View style={s.settingStatusRow}>
      <Text style={s.settingLabel}>{label}</Text>
      <Text style={[s.statusPill, on && s.statusOn]}>{statusText(value)}</Text>
    </View>
  )
}

const s = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0d0d0d' },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingBottom: 12 },
  backBtn: { color: '#6b7280', fontSize: 15, fontWeight: '500' },
  title: { color: '#e8ecf0', fontSize: 17, fontWeight: '700', fontFamily: 'monospace' },
  saveBtn: { color: '#00d4ff', fontSize: 15, fontWeight: '700' },

  scroll: { flex: 1 },
  scrollContent: { paddingHorizontal: 20, paddingBottom: 40, gap: 8 },

  sectionTitle: { color: '#e8ecf0', fontSize: 13, fontWeight: '700', marginTop: 20, letterSpacing: 1, textTransform: 'uppercase' },
  sectionDesc: { color: 'rgba(255,255,255,0.35)', fontSize: 12, marginBottom: 8, lineHeight: 17 },

  card: { backgroundColor: '#111111', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,0.06)', gap: 10 },
  rowHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 12 },
  cardTitle: { color: '#e8ecf0', fontSize: 15, fontWeight: '700' },
  cardDesc: { color: 'rgba(255,255,255,0.42)', fontSize: 12, marginTop: 2 },
  statusPill: { overflow: 'hidden', color: 'rgba(255,255,255,0.52)', fontSize: 11, fontWeight: '800', paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, backgroundColor: '#1f2937' },
  statusOn: { color: '#00150d', backgroundColor: '#00fc97' },
  errorText: { color: '#fca5a5', fontSize: 12, lineHeight: 17 },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 2 },
  actionRowWrap: { flexDirection: 'row', gap: 10, flexWrap: 'wrap', marginTop: 2 },
  smallBtn: { backgroundColor: '#00d4ff', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 9 },
  smallBtnText: { color: '#001018', fontSize: 12, fontWeight: '800' },
  smallBtnGhost: { backgroundColor: '#1a1a1a', paddingHorizontal: 12, paddingVertical: 9, borderRadius: 9, borderWidth: 1, borderColor: 'rgba(255,255,255,0.08)' },
  smallBtnGhostText: { color: '#cbd5e1', fontSize: 12, fontWeight: '700' },
  settingStatusRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  settingLabel: { color: '#d1d5db', fontSize: 13, fontWeight: '600' },
  refreshBtn: { alignSelf: 'flex-start', marginTop: 2, paddingVertical: 4 },
  refreshText: { color: '#67E8F9', fontSize: 12, fontWeight: '700' },

  voiceRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#111111', marginTop: 4, borderWidth: 1, borderColor: 'transparent' },
  voiceRowActive: { borderColor: '#00d4ff', backgroundColor: '#0a1a20' },
  voiceInfo: { flex: 1 },
  voiceName: { color: '#e8ecf0', fontSize: 15, fontWeight: '600' },
  voiceDesc: { color: 'rgba(255,255,255,0.4)', fontSize: 12, marginTop: 2 },
  checkmark: { color: '#00d4ff', fontSize: 16, fontWeight: '800' },

  colorRow: { flexDirection: 'row', gap: 12, flexWrap: 'wrap', marginTop: 8 },
  colorSwatch: { width: 44, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center' },
  colorSwatchActive: { borderWidth: 2.5, borderColor: '#fff' },
  colorCheck: { color: '#fff', fontSize: 16, fontWeight: '800' },

  resetBtn: { marginTop: 32, alignSelf: 'center', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8, backgroundColor: '#1a1a1a' },
  resetText: { color: '#ef4444', fontSize: 13, fontWeight: '600' },
})
