import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Storage adapter shape Supabase expects for session persistence.
 * Matches @supabase/supabase-js's `SupportedStorage` contract.
 */
export type SupabaseStorageAdapter = {
  getItem: (key: string) => Promise<string | null>;
  setItem: (key: string, value: string) => Promise<void>;
  removeItem: (key: string) => Promise<void>;
};

// Native (iOS, Android): use SecureStore so the session token is stored
// encrypted at rest in the platform keychain / EncryptedSharedPreferences.
const nativeStorage: SupabaseStorageAdapter = {
  getItem: (key) => SecureStore.getItemAsync(key),
  setItem: async (key, value) => {
    await SecureStore.setItemAsync(key, value);
  },
  removeItem: async (key) => {
    await SecureStore.deleteItemAsync(key);
  },
};

// Web (and any other environment without SecureStore): fall back to
// localStorage so dev builds in the browser don't crash. Web is not the
// primary target for SplitMate — ML Kit OCR is native-only — but boot
// should never crash because of storage.
const webStorage: SupabaseStorageAdapter = {
  getItem: async (key) => {
    if (typeof window === 'undefined') return null;
    return window.localStorage.getItem(key);
  },
  setItem: async (key, value) => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(key, value);
  },
  removeItem: async (key) => {
    if (typeof window === 'undefined') return;
    window.localStorage.removeItem(key);
  },
};

export const secureStorage: SupabaseStorageAdapter =
  Platform.OS === 'web' ? webStorage : nativeStorage;
