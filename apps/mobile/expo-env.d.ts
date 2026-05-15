/// <reference types="expo/types" />

// Expo environment variables (EXPO_PUBLIC_* prefix)
declare namespace NodeJS {
  interface ProcessEnv {
    EXPO_PUBLIC_SUPABASE_URL: string;
    EXPO_PUBLIC_SUPABASE_ANON_KEY: string;
  }
}
