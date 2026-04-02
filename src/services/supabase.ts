import 'react-native-url-polyfill/auto'
import { createClient } from '@supabase/supabase-js'
import * as SecureStore from 'expo-secure-store'
import Constants from 'expo-constants'

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

const supabaseUrlRaw = process.env.EXPO_PUBLIC_SUPABASE_URL || Constants.expoConfig?.extra?.supabaseUrl || process.env.SUPABASE_URL;
const supabaseAnonKeyRaw = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || Constants.expoConfig?.extra?.supabaseAnonKey || process.env.SUPABASE_ANON_KEY;

// Debug: Log environment status (without exposing secrets)
if (!supabaseUrlRaw || !supabaseAnonKeyRaw) {
  console.warn('Supabase keys missing in process.env. Check .env file and variable names.');
  console.log('Available EXPO_PUBLIC keys:', Object.keys(process.env).filter(k => k.startsWith('EXPO_PUBLIC')));
}

const supabaseUrl = supabaseUrlRaw?.trim();
const supabaseAnonKey = supabaseAnonKeyRaw?.trim();

export const isSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

export const supabase = isSupabaseConfigured
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        storage: ExpoSecureStoreAdapter as any,
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: false,
      },
    })
  : (null as any);

export const requireSupabase = () => {
  if (!isSupabaseConfigured) {
    throw new Error(
      'Supabase environment variables are missing. Configure EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY.'
    )
  }
  return supabase
}
