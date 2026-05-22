import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';

export type AuthResult<T = void> = { ok: true; data: T } | { ok: false; error: string };

export async function signIn(email: string, password: string): Promise<AuthResult<Session>> {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    return { ok: false, error: error?.message ?? 'Sign in failed' };
  }
  return { ok: true, data: data.session };
}

export async function signUp(
  email: string,
  password: string,
  displayName: string,
): Promise<AuthResult<Session | null>> {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } },
  });
  if (error) {
    return { ok: false, error: error.message };
  }
  // session is null when email confirmation is enabled; the caller decides what to do.
  return { ok: true, data: data.session };
}

export async function signOut(): Promise<AuthResult> {
  const { error } = await supabase.auth.signOut();
  if (error) return { ok: false, error: error.message };
  return { ok: true, data: undefined };
}

export async function getSession(): Promise<Session | null> {
  const { data } = await supabase.auth.getSession();
  return data.session;
}
