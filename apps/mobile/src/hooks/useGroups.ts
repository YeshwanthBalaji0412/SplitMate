import { useCallback, useEffect, useState } from 'react';
import type { Country, Group, GroupMember, GroupMemberRole, GroupType, Profile, SettlementMode } from '@splitmate/types';
import { supabase } from '@/lib/supabase';

// --- Row -> camelCase mappers (Supabase returns snake_case) -----------------

function rowToGroup(row: Record<string, unknown>): Group {
  return {
    id: row.id as string,
    name: row.name as string,
    description: (row.description as string | null) ?? null,
    type: row.type as GroupType,
    currency: row.currency as string,
    country: row.country as Country,
    settlementMode: row.settlement_mode as SettlementMode,
    createdBy: row.created_by as string,
    inviteCode: row.invite_code as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function rowToProfile(row: Record<string, unknown>): Profile {
  return {
    id: row.id as string,
    email: row.email as string,
    displayName: row.display_name as string,
    avatarUrl: (row.avatar_url as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

function rowToMember(row: Record<string, unknown>): GroupMember {
  return {
    id: row.id as string,
    groupId: row.group_id as string,
    userId: row.user_id as string,
    role: row.role as GroupMemberRole,
    joinedAt: row.joined_at as string,
  };
}

export type GroupMemberWithProfile = GroupMember & { profile: Profile | null };

// --- Hooks ------------------------------------------------------------------

/** List of groups the current user belongs to. Newest first. */
export function useGroups() {
  const [groups, setGroups] = useState<Group[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);

    const { data: sessionData } = await supabase.auth.getUser();
    const userId = sessionData.user?.id;
    if (!userId) {
      setGroups([]);
      setLoading(false);
      return;
    }

    const { data: memberships, error: mErr } = await supabase
      .from('group_members')
      .select('group_id')
      .eq('user_id', userId);

    if (mErr) {
      setError(mErr.message);
      setLoading(false);
      return;
    }

    const ids = (memberships ?? []).map((m) => m.group_id as string);
    if (ids.length === 0) {
      setGroups([]);
      setLoading(false);
      return;
    }

    const { data: rows, error: gErr } = await supabase
      .from('groups')
      .select('*')
      .in('id', ids)
      .order('created_at', { ascending: false });

    if (gErr) {
      setError(gErr.message);
      setLoading(false);
      return;
    }

    setGroups((rows ?? []).map(rowToGroup));
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return { groups, loading, error, refresh: load };
}

/** Single group by id. */
export function useGroup(id: string | undefined) {
  const [group, setGroup] = useState<Group | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) {
      setGroup(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const { data, error: e } = await supabase.from('groups').select('*').eq('id', id).maybeSingle();
    if (e) {
      setError(e.message);
      setLoading(false);
      return;
    }
    setGroup(data ? rowToGroup(data) : null);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  return { group, loading, error, refresh: load };
}

/** Members of a group, with their profile info joined in. */
export function useGroupMembers(groupId: string | undefined) {
  const [members, setMembers] = useState<GroupMemberWithProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!groupId) {
      setMembers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    // PostgREST resource embedding: group_members.user_id -> profiles.id
    const { data, error: e } = await supabase
      .from('group_members')
      .select('id, group_id, user_id, role, joined_at, profile:profiles(*)')
      .eq('group_id', groupId)
      .order('joined_at', { ascending: true });

    if (e) {
      setError(e.message);
      setLoading(false);
      return;
    }

    const mapped: GroupMemberWithProfile[] = (data ?? []).map((row) => {
      // PostgREST returns the embed as either an object (1:1 FK) or an array.
      // Normalize to a single profile or null.
      const rawProfile = (row as { profile: unknown }).profile;
      const profileRow = Array.isArray(rawProfile) ? rawProfile[0] : rawProfile;
      return {
        ...rowToMember(row as Record<string, unknown>),
        profile: profileRow ? rowToProfile(profileRow as Record<string, unknown>) : null,
      };
    });

    setMembers(mapped);
    setLoading(false);
  }, [groupId]);

  useEffect(() => {
    load();
  }, [load]);

  return { members, loading, error, refresh: load };
}

// --- Create + invite --------------------------------------------------------

export type CreateGroupInput = {
  name: string;
  type: GroupType;
  currency: string;
  country: Country;
  settlementMode: SettlementMode;
};

export type CreateGroupResult = { ok: true; group: Group } | { ok: false; error: string };

/**
 * Create a group and immediately insert the creator as the owning member.
 * Both inserts respect the RLS policies set in migration 001:
 *  - groups_insert_creator: created_by = auth.uid()
 *  - group_members_insert_self: user_id = auth.uid()
 */
export async function createGroup(input: CreateGroupInput): Promise<CreateGroupResult> {
  const { data: sessionData } = await supabase.auth.getUser();
  const userId = sessionData.user?.id;
  if (!userId) return { ok: false, error: 'Not signed in.' };

  const { data: groupRow, error: gErr } = await supabase
    .from('groups')
    .insert({
      name: input.name,
      type: input.type,
      currency: input.currency,
      country: input.country,
      settlement_mode: input.settlementMode,
      created_by: userId,
    })
    .select('*')
    .single();

  if (gErr || !groupRow) {
    return { ok: false, error: gErr?.message ?? 'Failed to create group.' };
  }

  const { error: mErr } = await supabase.from('group_members').insert({
    group_id: groupRow.id,
    user_id: userId,
    role: 'owner',
  });

  if (mErr) {
    // The group exists but the creator isn't a member. Surface the error;
    // the user can retry the membership insert from the join screen if needed.
    return { ok: false, error: `Group created but membership failed: ${mErr.message}` };
  }

  return { ok: true, group: rowToGroup(groupRow) };
}
