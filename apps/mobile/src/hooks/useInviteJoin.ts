import type { Country } from '@splitmate/types';
import { supabase } from '@/lib/supabase';
import { isValidInviteCode, normalizeInviteCode } from '@/lib/inviteCode';

export type InviteLookup = {
  id: string;
  name: string;
  currency: string;
  country: Country;
};

export type JoinResult =
  | { ok: true; groupId: string; alreadyMember: boolean }
  | { ok: false; error: string };

/**
 * Look up a group by its invite code via the SECURITY DEFINER RPC
 * (migration 004). Returns the minimal preview row, or null if the code
 * doesn't match anything.
 */
export async function lookupGroupByInviteCode(rawCode: string): Promise<InviteLookup | null> {
  const code = normalizeInviteCode(rawCode);
  if (!isValidInviteCode(code)) return null;

  const { data, error } = await supabase.rpc('find_group_by_invite_code', { code });
  if (error || !data || data.length === 0) return null;

  const row = data[0] as Record<string, unknown>;
  return {
    id: row.id as string,
    name: row.name as string,
    currency: row.currency as string,
    country: row.country as Country,
  };
}

/**
 * One-shot join: look up the code, insert the membership, return the
 * group id. If the user is already a member, return success with
 * `alreadyMember: true` so the caller can still navigate to the group.
 */
export async function joinGroupByInviteCode(rawCode: string): Promise<JoinResult> {
  const code = normalizeInviteCode(rawCode);
  if (!isValidInviteCode(code)) {
    return { ok: false, error: 'Invite codes are 12 letters/numbers. Check what you pasted.' };
  }

  const { data: sessionData } = await supabase.auth.getUser();
  const userId = sessionData.user?.id;
  if (!userId) return { ok: false, error: 'Not signed in.' };

  const lookup = await lookupGroupByInviteCode(code);
  if (!lookup) return { ok: false, error: 'No group found with that invite code.' };

  const { error: insertError } = await supabase.from('group_members').insert({
    group_id: lookup.id,
    user_id: userId,
    role: 'member',
  });

  if (insertError) {
    // Unique violation -> already a member. That's fine, treat as success.
    const msg = insertError.message.toLowerCase();
    if (msg.includes('duplicate') || msg.includes('unique')) {
      return { ok: true, groupId: lookup.id, alreadyMember: true };
    }
    return { ok: false, error: insertError.message };
  }

  return { ok: true, groupId: lookup.id, alreadyMember: false };
}
