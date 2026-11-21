import { create } from 'zustand'

export interface AppSettings {
  silenceMs: number       // silence before sending (ms)
  voiceId: string         // ElevenLabs voice ID
  voiceName: string       // display name
  ttsModel: string        // ElevenLabs model
  orbColor: string        // primary orb color hex
  accentColor: string     // accent color hex
  bgColor: string         // background color hex
  soundEnabled: boolean   // connect/send sounds
  wakeWord: string        // wake word to activate listening
  cameraEnabled: boolean  // camera mode available
}

interface SettingsStore extends AppSettings {
  set: (partial: Partial<AppSettings>) => void
  reset: () => void
}

const DEFAULTS: AppSettings = {
  silenceMs: 3000,
  voiceId: 'Zephyr',         // Gemini Live built-in voice name
  voiceName: 'Zephyr',
  ttsModel: '',
  orbColor: '#00d4ff',
  accentColor: '#67E8F9',
  bgColor: '#0d0d0d',
  soundEnabled: true,
  wakeWord: 'm8',
  cameraEnabled: false,
}

export const useSettings = create<SettingsStore>((set) => ({
  ...DEFAULTS,
  set: (partial) => set(partial),
  reset: () => set(DEFAULTS),
}))

// Persist to storage
let storageModule: any = null
async function loadStorage() {
  if (!storageModule) {
    try { storageModule = await import('../services/storage') } catch { return }
  }
  try {
    const raw = await storageModule.getItem('app_settings')
    if (raw) {
      const parsed = JSON.parse(raw)
      useSettings.getState().set(parsed)
    }
  } catch {}
}

export async function saveSettings() {
  if (!storageModule) {
    try { storageModule = await import('../services/storage') } catch { return }
  }
  const { set, reset, ...data } = useSettings.getState()
  try { await storageModule.setItem('app_settings', JSON.stringify(data)) } catch {}
}

// Auto-load on import
loadStorage()
