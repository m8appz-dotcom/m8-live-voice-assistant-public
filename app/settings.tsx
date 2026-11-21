import { useState } from 'react'
import {
  View, Text, TouchableOpacity, StyleSheet,
  ScrollView,
} from 'react-native'
import { useRouter } from 'expo-router'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useSettings, saveSettings } from '../src/stores/settings'

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

export default function Settings() {
  const router = useRouter()
  const insets = useSafeAreaInsets()
  const settings = useSettings()

  const handleSave = async () => {
    await saveSettings()
    router.back()
  }

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

        {/* Voice */}
        <Text style={s.sectionTitle}>Voice</Text>
        <Text style={s.sectionDesc}>Gemini Live built-in voice (takes effect on next session)</Text>
        {VOICES.map(v => (
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

        {/* Orb Color */}
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

        {/* Reset */}
        <TouchableOpacity style={s.resetBtn} onPress={settings.reset} activeOpacity={0.7}>
          <Text style={s.resetText}>Reset to Defaults</Text>
        </TouchableOpacity>

        <View style={{ height: 40 }} />
      </ScrollView>
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
  sectionDesc: { color: 'rgba(255,255,255,0.35)', fontSize: 12, marginBottom: 8 },

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
