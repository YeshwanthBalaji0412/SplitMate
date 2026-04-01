import { createBrowserClient } from '@supabase/ssr';

/**
 * Browser-side Supabase client — use this in Client Components.
 * Reads from NEXT_PUBLIC_ env vars so it's safe to call on the client.
 */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
