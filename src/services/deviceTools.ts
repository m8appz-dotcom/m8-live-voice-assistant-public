import * as DocumentPicker from 'expo-document-picker'
import * as Haptics from 'expo-haptics'
import * as Linking from 'expo-linking'
import type { ToolDeclaration, ToolResult } from '../types/realtime'

export const LOCAL_DEVICE_TOOL_DECLARATIONS: ToolDeclaration[] = [
  {
    name: 'device_get_permissions',
    description: 'Return local device permission status relevant to the live session.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'device_get_location',
    description: 'Ask the user/browser for current location and return latitude/longitude for nearby search, routing, maps, travel, weather, and local recommendations. Use only when the user request needs location.',
    parameters: {
      type: 'OBJECT',
      properties: {
        enableHighAccuracy: { type: 'BOOLEAN', description: 'Use GPS/high accuracy when available.' },
      },
    },
  },
  {
    name: 'device_open_camera',
    description: 'Open the live camera preview inside the current UI without changing the layout.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'device_stop_camera',
    description: 'Stop the current camera preview.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'device_toggle_mic',
    description: 'Toggle the microphone on or off in the current live session.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'device_pick_image',
    description: 'Pick an image from the device and return its URI.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'device_pick_file',
    description: 'Pick a file from the device and return metadata.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'device_open_url',
    description: 'Open a URL using the device.',
    parameters: {
      type: 'OBJECT',
      properties: {
        url: { type: 'STRING', description: 'URL to open.' },
      },
      required: ['url'],
    },
  },
  {
    name: 'device_vibrate',
    description: 'Trigger a short haptic pulse on the device.',
    parameters: { type: 'OBJECT', properties: {} },
  },
]

export type DeviceToolContext = {
  cameraGranted: boolean
  micOn: boolean
  openCamera: () => Promise<void>
  stopCamera: () => void
  toggleMic: () => Promise<void>
}

export function isLocalDeviceTool(name?: string) {
  return !!name && LOCAL_DEVICE_TOOL_DECLARATIONS.some((tool) => tool.name === name)
}

export async function invokeLocalDeviceTool(name: string, args: Record<string, unknown>, ctx: DeviceToolContext): Promise<ToolResult> {
  switch (name) {
    case 'device_get_permissions':
      return { ok: true, camera: ctx.cameraGranted, microphoneActive: ctx.micOn, geolocation: typeof navigator !== 'undefined' && 'geolocation' in navigator ? 'available' : 'unavailable' }
    case 'device_get_location': {
      if (typeof navigator === 'undefined' || !navigator.geolocation) return { ok: false, error: 'Geolocation is not available on this device.' }
      const enableHighAccuracy = args?.enableHighAccuracy !== false
      const position = await new Promise<GeolocationPosition>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, {
          enableHighAccuracy,
          timeout: 12_000,
          maximumAge: 60_000,
        })
      }).catch((error: GeolocationPositionError) => {
        const message = error?.message || 'Location permission denied or unavailable.'
        throw new Error(message)
      })
      return {
        ok: true,
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracyMeters: position.coords.accuracy,
        altitude: position.coords.altitude,
        heading: position.coords.heading,
        speed: position.coords.speed,
        timestamp: position.timestamp,
      }
    }
    case 'device_open_camera':
      await ctx.openCamera()
      return { ok: true, message: 'Camera preview opened.' }
    case 'device_stop_camera':
      ctx.stopCamera()
      return { ok: true, message: 'Camera preview stopped.' }
    case 'device_toggle_mic':
      await ctx.toggleMic()
      return { ok: true, message: ctx.micOn ? 'Microphone turned off.' : 'Microphone turned on.' }
    case 'device_pick_image': {
      const result = await DocumentPicker.getDocumentAsync({
        multiple: false,
        copyToCacheDirectory: true,
        type: ['image/*'],
      })
      if (result.canceled || !result.assets?.length) return { ok: false, error: 'No image selected.' }
      const asset = result.assets[0]
      return { ok: true, uri: asset.uri, mimeType: asset.mimeType || 'image/jpeg', fileName: asset.name }
    }
    case 'device_pick_file': {
      const result = await DocumentPicker.getDocumentAsync({ multiple: false, copyToCacheDirectory: true })
      if (result.canceled || !result.assets?.length) return { ok: false, error: 'No file selected.' }
      const asset = result.assets[0]
      return { ok: true, uri: asset.uri, mimeType: asset.mimeType || 'application/octet-stream', name: asset.name, size: asset.size }
    }
    case 'device_open_url': {
      const url = String(args?.url || '').trim()
      if (!url) return { ok: false, error: 'url required' }
      await Linking.openURL(url)
      return { ok: true, message: `Opened ${url}` }
    }
    case 'device_vibrate':
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
      return { ok: true, message: 'Haptic pulse sent.' }
    default:
      return { ok: false, error: `Unsupported device tool: ${name}` }
  }
}
