-- ============================================================================
-- SplitMate -- Migration 004: Invite-Code Lookup RPC
-- ----------------------------------------------------------------------------
-- The RLS policy on `groups` requires `is_group_member(id)` to read a row.
-- That correctly hides groups from non-members -- but it also blocks the
-- join-by-invite-code flow, where the user needs to look up a group BEFORE
-- they become a member.
--
-- This SECURITY DEFINER function bypasses RLS to expose minimal,
-- non-sensitive group info (id, name, currency, country) keyed by the
-- invite code. It returns at most one row and only fields the joining
-- user needs to confirm they're joining the right group.
-- ============================================================================

CREATE OR REPLACE FUNCTION find_group_by_invite_code(code TEXT)
RETURNS TABLE (
  id        UUID,
  name      TEXT,
  currency  CHAR(3),
  country   CHAR(2)
)
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT g.id, g.name, g.currency, g.country
  FROM groups g
  WHERE g.invite_code = code
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION find_group_by_invite_code(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION find_group_by_invite_code(TEXT) TO authenticated;
