import 'react-native-url-polyfill/auto'
import { createClient } from '@supabase/supabase-js'
import * as SecureStore from 'expo-secure-store'

const ExpoSecureStoreAdapter = {
  getItem: (key: string) => {
    return SecureStore.getItemAsync(key)
  },
  setItem: (key: string, value: string) => {
    SecureStore.setItemAsync(key, value)
  },
  removeItem: (key: string) => {
    SecureStore.deleteItemAsync(key)
  },
}

const supabaseUrlRaw = process.env.EXPO_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
const supabaseAnonKeyRaw = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY

const supabaseUrl = supabaseUrlRaw?.trim()
const supabaseAnonKey = supabaseAnonKeyRaw?.trim()

export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey)

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
  auth: {
    storage: ExpoSecureStoreAdapter as any,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
  })
  : (null as any)

export const requireSupabase = () => {
  if (!isSupabaseConfigured) {
    throw new Error(
      'Supabase environment variables are missing. Configure EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.'
    )
  }
  return supabase
}
