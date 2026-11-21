import { useEffect } from 'react'
import { Stack, router } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import * as Notifications from 'expo-notifications'
import { useKeepAwake } from 'expo-keep-awake'
import { colors } from '../src/theme/colors'
import { getWakeIdFromNotificationResponse, registerAndroidPushDevice } from '../src/services/push'

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
})

export default function RootLayout() {
  useKeepAwake()

  useEffect(() => {
    void registerAndroidPushDevice(false).catch((error) => console.warn('[m8live] push registration skipped:', String(error?.message || error)))

    const openWake = (wakeId: string) => {
      if (!wakeId) return
      router.push({ pathname: '/live', params: { wakeId } })
    }

    Notifications.getLastNotificationResponseAsync()
      .then((response) => openWake(getWakeIdFromNotificationResponse(response)))
      .catch(() => {})

    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      openWake(getWakeIdFromNotificationResponse(response))
    })
    return () => sub.remove()
  }, [])

  return (
    <>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerStyle: { backgroundColor: colors.surface },
          headerTintColor: colors.emerald,
          headerTitleStyle: { fontWeight: '700', fontSize: 17 },
          contentStyle: { backgroundColor: colors.bg },
          animation: 'slide_from_right',
        }}
      >
        <Stack.Screen name="index" options={{ title: 'm8live' }} />
        <Stack.Screen name="demo" options={{ headerShown: false }} />
        <Stack.Screen name="setup" options={{ title: 'Setup', presentation: 'modal' }} />
        <Stack.Screen
          name="live"
          options={{
            title: 'Live Session',
            headerShown: false,
            gestureEnabled: false,
          }}
        />
        <Stack.Screen
          name="settings"
          options={{
            title: 'Settings',
            headerShown: false,
            presentation: 'modal',
          }}
        />
      </Stack>
    </>
  )
}
