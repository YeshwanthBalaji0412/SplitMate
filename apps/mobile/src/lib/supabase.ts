import 'react-native-url-polyfill/auto';
import { createClient } from '@supabase/supabase-js';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

/**
 * Storage adapter — uses SecureStore on native (Keychain / EncryptedSharedPreferences)
 * and localStorage on web.
 */
const storage = Platform.OS === 'web'
  ? {
      getItem: (key: string) => {
        try { return localStorage.getItem(key); }
        catch { return null; }
      },
      setItem: (key: string, value: string) => {
        try { localStorage.setItem(key, value); }
        catch {}
      },
      removeItem: (key: string) => {
        try { localStorage.removeItem(key); }
        catch {}
      },
    }
  : {
      getItem: (key: string) => SecureStore.getItemAsync(key),
      setItem: (key: string, value: string) => SecureStore.setItemAsync(key, value),
      removeItem: (key: string) => SecureStore.deleteItemAsync(key),
    };

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
