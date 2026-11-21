// Cross-platform storage: AsyncStorage on native, localStorage on web
import { Platform } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'

export async function getItem(key: string): Promise<string | null> {
  if (Platform.OS === 'web') {
    return localStorage.getItem(key)
  }
  return AsyncStorage.getItem(key)
}

export async function setItem(key: string, value: string): Promise<void> {
  if (Platform.OS === 'web') {
    localStorage.setItem(key, value)
    return
  }
  await AsyncStorage.setItem(key, value)
}
