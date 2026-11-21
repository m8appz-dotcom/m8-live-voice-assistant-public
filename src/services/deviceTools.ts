import * as DocumentPicker from 'expo-document-picker'
import * as Haptics from 'expo-haptics'
import * as Linking from 'expo-linking'
import { NativeModules, Platform } from 'react-native'
import type { ToolDeclaration, ToolResult } from '../types/realtime'

const AndroidDeviceControl = NativeModules.M8DeviceControl

function parseNativeJson(value: unknown) {
  if (typeof value !== 'string') return value
  try { return JSON.parse(value) } catch { return value }
}

function requireAndroidControl(): { ok: true; module: typeof AndroidDeviceControl } | { ok: false; error: string } {
  if (Platform.OS !== 'android') return { ok: false, error: 'Android device control is only available on Android builds.' }
  if (!AndroidDeviceControl) return { ok: false, error: 'Native Android device control module is not available in this build.' }
  return { ok: true, module: AndroidDeviceControl }
}

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
  {
    name: 'android_control_status',
    description: 'Return Android native control status, including whether Accessibility and Notification Listener permissions are enabled.',
    parameters: { type: 'OBJECT', properties: {} },
  },
  {
    name: 'android_open_control_settings',
    description: 'Open Android settings required to grant M8 Live Accessibility, Notification Listener, or app permissions.',
    parameters: {
      type: 'OBJECT',
      properties: { target: { type: 'STRING', description: 'One of: accessibility, notifications, app.' } },
      required: ['target'],
    },
  },
  {
    name: 'android_list_apps',
    description: 'List installed Android apps so M8 can open the correct package. Use small max values unless Boss asks broadly.',
    parameters: { type: 'OBJECT', properties: { max: { type: 'NUMBER', description: 'Maximum apps to return, default 80.' } } },
  },
  {
    name: 'android_open_app',
    description: 'Open an installed Android app by package name.',
    parameters: { type: 'OBJECT', properties: { packageName: { type: 'STRING', description: 'Android package name, for example com.whatsapp.' } }, required: ['packageName'] },
  },
  {
    name: 'android_share_text',
    description: 'Open Android share sheet with text prepared by M8. The user still chooses the destination.',
    parameters: { type: 'OBJECT', properties: { text: { type: 'STRING', description: 'Text to share.' }, title: { type: 'STRING', description: 'Optional share sheet title.' } }, required: ['text'] },
  },
  {
    name: 'android_dial_number',
    description: 'Open Android phone dialer with a number filled in. Does not place the call automatically.',
    parameters: { type: 'OBJECT', properties: { number: { type: 'STRING', description: 'Phone number to dial.' } }, required: ['number'] },
  },
  {
    name: 'android_set_clipboard',
    description: 'Copy text to the Android clipboard.',
    parameters: { type: 'OBJECT', properties: { text: { type: 'STRING', description: 'Text to copy.' } }, required: ['text'] },
  },
  {
    name: 'android_screen_tree',
    description: 'Read the current Android screen structure via Accessibility: visible text, descriptions, bounds, and clickable/editable hints.',
    parameters: { type: 'OBJECT', properties: { maxNodes: { type: 'NUMBER', description: 'Maximum nodes to return, default 80.' } } },
  },
  {
    name: 'android_global_action',
    description: 'Perform Android global navigation via Accessibility. Allowed actions: back, home, recents, notifications, quick_settings, power_dialog, lock_screen.',
    parameters: { type: 'OBJECT', properties: { action: { type: 'STRING', description: 'Global action name.' } }, required: ['action'] },
  },
  {
    name: 'android_tap',
    description: 'Tap absolute screen coordinates via Accessibility. Use android_screen_tree first when possible to choose coordinates.',
    parameters: { type: 'OBJECT', properties: { x: { type: 'NUMBER' }, y: { type: 'NUMBER' } }, required: ['x', 'y'] },
  },
  {
    name: 'android_swipe',
    description: 'Swipe absolute screen coordinates via Accessibility.',
    parameters: { type: 'OBJECT', properties: { x1: { type: 'NUMBER' }, y1: { type: 'NUMBER' }, x2: { type: 'NUMBER' }, y2: { type: 'NUMBER' }, durationMs: { type: 'NUMBER' } }, required: ['x1', 'y1', 'x2', 'y2'] },
  },
  {
    name: 'android_type_text',
    description: 'Set text into the currently focused Android text field via Accessibility. Use only after Boss asks to type or compose something.',
    parameters: { type: 'OBJECT', properties: { text: { type: 'STRING' } }, required: ['text'] },
  },
  {
    name: 'android_click_text',
    description: 'Click a visible Android UI element by matching text, content description, or view id via Accessibility. Prefer this over raw coordinates after reading android_screen_tree.',
    parameters: { type: 'OBJECT', properties: { query: { type: 'STRING', description: 'Text/description/view id to click.' }, exact: { type: 'BOOLEAN', description: 'Require exact case-insensitive match.' } }, required: ['query'] },
  },
  {
    name: 'android_wait_for_text',
    description: 'Wait until text, content description, or view id appears on the Android screen via Accessibility. Use after opening apps, tapping, typing, or navigating to verify state.',
    parameters: { type: 'OBJECT', properties: { query: { type: 'STRING', description: 'Text/description/view id to wait for.' }, timeoutMs: { type: 'NUMBER', description: 'Timeout in ms, default 4000, max 15000.' }, exact: { type: 'BOOLEAN', description: 'Require exact case-insensitive match.' } }, required: ['query'] },
  },
  {
    name: 'android_active_notifications',
    description: 'Read active Android notifications through Notification Listener permission. Returns notification previews, expanded text, text lines, and MessagingStyle messages when apps expose them.',
    parameters: { type: 'OBJECT', properties: { max: { type: 'NUMBER', description: 'Maximum notifications to return, default 30.' } } },
  },
  {
    name: 'android_read_sms_inbox',
    description: 'Read recent SMS/MMS inbox rows using Android READ_SMS. Use only after Boss explicitly asks for SMS content; this is privacy-sensitive and may not be Play Store eligible.',
    parameters: { type: 'OBJECT', properties: { max: { type: 'NUMBER', description: 'Maximum messages to return, default 20.' } } },
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
    case 'android_control_status': {
      const native = requireAndroidControl()
      if (!native.ok) return native
      return { ok: true, ...(await native.module.status()) }
    }
    case 'android_open_control_settings': {
      const native = requireAndroidControl()
      if (!native.ok) return native
      const target = String(args?.target || '').toLowerCase()
      if (target === 'accessibility') await native.module.openAccessibilitySettings()
      else if (target === 'notifications') await native.module.openNotificationListenerSettings()
      else if (target === 'app') await native.module.openAppDetailsSettings()
      else return { ok: false, error: 'target must be accessibility, notifications, or app' }
      return { ok: true, message: `Opened Android ${target} settings.` }
    }
    case 'android_list_apps': {
      const native = requireAndroidControl()
      if (!native.ok) return native
      return { ok: true, apps: parseNativeJson(await native.module.listInstalledApps(Number(args?.max || 80))) }
    }
    case 'android_open_app': {
      const native = requireAndroidControl()
      if (!native.ok) return native
      const packageName = String(args?.packageName || '').trim()
      if (!packageName) return { ok: false, error: 'packageName required' }
      const opened = await native.module.openApp(packageName)
      return opened ? { ok: true, message: `Opened ${packageName}.` } : { ok: false, error: `No launchable app found for ${packageName}.` }
    }
    case 'android_share_text': {
      const native = requireAndroidControl()
      if (!native.ok) return native
      const text = String(args?.text || '')
      if (!text) return { ok: false, error: 'text required' }
      await native.module.shareText(text, typeof args?.title === 'string' ? args.title : null)
      return { ok: true, message: 'Opened Android share sheet.' }
    }
    case 'android_dial_number': {
      const native = requireAndroidControl()
      if (!native.ok) return native
      const number = String(args?.number || '').trim()
      if (!number) return { ok: false, error: 'number required' }
      await native.module.dialNumber(number)
      return { ok: true, message: 'Opened dialer. Boss must press call.' }
    }
    case 'android_set_clipboard': {
      const native = requireAndroidControl()
      if (!native.ok) return native
      await native.module.setClipboard(String(args?.text || ''))
      return { ok: true, message: 'Copied text to clipboard.' }
    }
    case 'android_screen_tree': {
      const native = requireAndroidControl()
      if (!native.ok) return native
      return parseNativeJson(await native.module.accessibilityScreenTree(Number(args?.maxNodes || 80))) as ToolResult
    }
    case 'android_global_action': {
      const native = requireAndroidControl()
      if (!native.ok) return native
      const action = String(args?.action || '').trim()
      const ok = await native.module.accessibilityGlobalAction(action)
      return ok ? { ok: true, message: `Performed ${action}.` } : { ok: false, error: 'Accessibility service disabled or action failed.' }
    }
    case 'android_tap': {
      const native = requireAndroidControl()
      if (!native.ok) return native
      const ok = await native.module.accessibilityTap(Number(args?.x), Number(args?.y))
      return ok ? { ok: true, message: 'Tapped screen.' } : { ok: false, error: 'Accessibility service disabled or tap failed.' }
    }
    case 'android_swipe': {
      const native = requireAndroidControl()
      if (!native.ok) return native
      const ok = await native.module.accessibilitySwipe(Number(args?.x1), Number(args?.y1), Number(args?.x2), Number(args?.y2), Number(args?.durationMs || 350))
      return ok ? { ok: true, message: 'Swiped screen.' } : { ok: false, error: 'Accessibility service disabled or swipe failed.' }
    }
    case 'android_type_text': {
      const native = requireAndroidControl()
      if (!native.ok) return native
      const ok = await native.module.accessibilityTypeText(String(args?.text || ''))
      return ok ? { ok: true, message: 'Typed into focused field.' } : { ok: false, error: 'No focused editable field or Accessibility service disabled.' }
    }
    case 'android_click_text': {
      const native = requireAndroidControl()
      if (!native.ok) return native
      const query = String(args?.query || '').trim()
      if (!query) return { ok: false, error: 'query required' }
      const ok = await native.module.accessibilityClickText(query, args?.exact === true)
      return ok ? { ok: true, message: `Clicked ${query}.` } : { ok: false, error: `No clickable match found for ${query}.` }
    }
    case 'android_wait_for_text': {
      const native = requireAndroidControl()
      if (!native.ok) return native
      const query = String(args?.query || '').trim()
      if (!query) return { ok: false, error: 'query required' }
      return parseNativeJson(await native.module.accessibilityWaitForText(query, Number(args?.timeoutMs || 4000), args?.exact === true)) as ToolResult
    }
    case 'android_active_notifications': {
      const native = requireAndroidControl()
      if (!native.ok) return native
      return parseNativeJson(await native.module.activeNotifications(Number(args?.max || 30))) as ToolResult
    }
    case 'android_read_sms_inbox': {
      const native = requireAndroidControl()
      if (!native.ok) return native
      return parseNativeJson(await native.module.readSmsInbox(Number(args?.max || 20))) as ToolResult
    }
    default:
      return { ok: false, error: `Unsupported device tool: ${name}` }
  }
}
