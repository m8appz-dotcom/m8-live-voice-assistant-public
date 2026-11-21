import { Platform } from 'react-native'
import * as Notifications from 'expo-notifications'
import Constants from 'expo-constants'
import { getDeviceRegistrationHeaders, getToolBase } from './appConfig'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
})

function getProjectId() {
  return (
    Constants.expoConfig?.extra?.eas?.projectId ||
    Constants.easConfig?.projectId ||
    process.env.EXPO_PUBLIC_EAS_PROJECT_ID ||
    ''
  )
}

export function getWakeIdFromNotificationResponse(response: Notifications.NotificationResponse | null | undefined) {
  const data = response?.notification?.request?.content?.data || {}
  const wakeId = data.wakeId || data.wake_id
  return typeof wakeId === 'string' ? wakeId : ''
}

export async function registerAndroidPushDevice(isWeb: boolean) {
  if (Platform.OS === 'web') return { ok: false, skipped: 'web' }

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('m8live-wake', {
      name: 'M8 Live wake alerts',
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: '#00ffff',
      sound: 'default',
      lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
    })
  }

  const current = await Notifications.getPermissionsAsync()
  let finalStatus = current.status
  if (current.status !== 'granted') {
    const requested = await Notifications.requestPermissionsAsync()
    finalStatus = requested.status
  }
  if (finalStatus !== 'granted') return { ok: false, error: 'notification permission denied' }

  const projectId = getProjectId()
  const tokenResult = projectId
    ? await Notifications.getExpoPushTokenAsync({ projectId })
    : await Notifications.getExpoPushTokenAsync()
  const expoPushToken = tokenResult.data

  const res = await fetch(`${getToolBase(isWeb)}/api/devices/register`, {
    method: 'POST',
    credentials: isWeb ? 'same-origin' : undefined,
    headers: {
      'Content-Type': 'application/json',
      ...getDeviceRegistrationHeaders(),
    },
    body: JSON.stringify({
      platform: Platform.OS,
      expoPushToken,
      projectId: projectId || undefined,
      app: 'm8live',
    }),
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok || !json?.ok) throw new Error(json?.error || `device registration failed (${res.status})`)
  return { ok: true, expoPushToken, device: json.device }
}
