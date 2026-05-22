-- ============================================================================
-- SplitMate -- Migration 005: Atomic group creation RPC
-- ----------------------------------------------------------------------------
-- Why this exists:
-- The natural client flow is "insert into groups, then insert into
-- group_members". With PostgREST, the typical `.insert(...).select('*')`
-- pattern asks the server to return the inserted row, which requires
-- SELECT permission on it. The SELECT policy on `groups` requires
-- membership -- but the user isn't a member yet at that point (the
-- membership insert is the next step), so the SELECT is rejected and
-- the whole INSERT round-trip fails with 403.
--
-- Bundling both inserts into a SECURITY DEFINER function makes them
-- atomic: by the time control returns to the client, the creator is
-- already a member, so all subsequent reads succeed via the existing
-- `is_group_member` policy.
-- ============================================================================

CREATE OR REPLACE FUNCTION create_group_with_owner(
  p_name             TEXT,
  p_type             TEXT,
  p_currency         CHAR(3),
  p_country          CHAR(2),
  p_settlement_mode  TEXT
) RETURNS groups
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid    UUID;
  v_group  groups;
BEGIN
  v_uid := auth.uid();
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'must be authenticated to create a group';
  END IF;

  INSERT INTO groups (name, type, currency, country, settlement_mode, created_by)
  VALUES (p_name, p_type, p_currency, p_country, p_settlement_mode, v_uid)
  RETURNING * INTO v_group;

  INSERT INTO group_members (group_id, user_id, role)
  VALUES (v_group.id, v_uid, 'owner');

  RETURN v_group;
END;
$$;

REVOKE ALL ON FUNCTION create_group_with_owner(TEXT, TEXT, CHAR(3), CHAR(2), TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_group_with_owner(TEXT, TEXT, CHAR(3), CHAR(2), TEXT) TO authenticated;
