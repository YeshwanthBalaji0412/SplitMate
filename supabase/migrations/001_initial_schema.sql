-- ============================================================================
-- SplitMate -- Migration 001: Initial Schema
-- ----------------------------------------------------------------------------
-- Creates the base relational model: profiles, groups, group_members,
-- expenses, line_items, line_item_participants, charge_components,
-- expense_participants, settlements, receipt_assets.
--
-- Conventions:
--   * Money columns are NUMERIC(12,2) so cents never drift.
--   * UUID primary keys via pgcrypto.
--   * Categorical columns use TEXT + CHECK so the set can evolve without
--     fighting CREATE TYPE / ALTER TYPE.
--   * Row Level Security is enabled on every public table. A user can only
--     see rows in groups they belong to.
--   * The helper function is_group_member() uses SECURITY DEFINER to bypass
--     RLS on group_members and avoid policy recursion.
--
-- Run order: 001 -> 002 -> 003
-- ============================================================================

-- ---- Extensions -----------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---- Shared updated_at trigger function -----------------------------------
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- Tables (created first; policies attached after is_group_member exists)
-- ============================================================================

-- ---- profiles -------------------------------------------------------------
CREATE TABLE profiles (
  id            UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email         TEXT NOT NULL,
  display_name  TEXT NOT NULL,
  avatar_url    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- groups ---------------------------------------------------------------
CREATE TABLE groups (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  description  TEXT,
  type         TEXT NOT NULL DEFAULT 'other'
                 CHECK (type IN ('trip', 'roommates', 'household', 'event', 'other')),
  currency     CHAR(3) NOT NULL DEFAULT 'USD',
  created_by   UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  invite_code  TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(6), 'hex'),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_groups_updated_at
  BEFORE UPDATE ON groups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- group_members --------------------------------------------------------
CREATE TABLE group_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role       TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'member')),
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (group_id, user_id)
);

CREATE INDEX idx_group_members_group ON group_members(group_id);
CREATE INDEX idx_group_members_user  ON group_members(user_id);

-- ---- expenses -------------------------------------------------------------
CREATE TABLE expenses (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  description   TEXT,
  total_amount  NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
  currency      CHAR(3) NOT NULL,
  category      TEXT NOT NULL DEFAULT 'other'
                  CHECK (category IN ('food','travel','accommodation','utility','entertainment','other')),
  paid_by       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date          DATE NOT NULL,
  status        TEXT NOT NULL DEFAULT 'active'
                  CHECK (status IN ('active','settled','archived')),
  split_method  TEXT NOT NULL DEFAULT 'equal'
                  CHECK (split_method IN ('equal','itemized','exact','percentage')),
  created_by    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_expenses_group ON expenses(group_id);
CREATE INDEX idx_expenses_paid  ON expenses(paid_by);
CREATE INDEX idx_expenses_date  ON expenses(date);

CREATE TRIGGER trg_expenses_updated_at
  BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- line_items -----------------------------------------------------------
CREATE TABLE line_items (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id   UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  name         TEXT NOT NULL,
  quantity     NUMERIC(10,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price   NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  total_price  NUMERIC(12,2) NOT NULL CHECK (total_price >= 0),
  position     INT NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_line_items_expense ON line_items(expense_id);

CREATE TRIGGER trg_line_items_updated_at
  BEFORE UPDATE ON line_items
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- line_item_participants ----------------------------------------------
CREATE TABLE line_item_participants (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_item_id  UUID NOT NULL REFERENCES line_items(id) ON DELETE CASCADE,
  user_id       UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  shares        NUMERIC(10,3) NOT NULL DEFAULT 1 CHECK (shares > 0),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (line_item_id, user_id)
);

CREATE INDEX idx_lip_item ON line_item_participants(line_item_id);
CREATE INDEX idx_lip_user ON line_item_participants(user_id);

-- ---- charge_components ----------------------------------------------------
CREATE TABLE charge_components (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id        UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  type              TEXT NOT NULL
                      CHECK (type IN ('tax','tip','service','delivery','platform','surge','discount','bag_fee','other')),
  label             TEXT NOT NULL,
  amount            NUMERIC(12,2) NOT NULL,
  rate              NUMERIC(6,4),
  allocation_rule   TEXT NOT NULL DEFAULT 'proportional_subtotal'
                      CHECK (allocation_rule IN (
                        'proportional_subtotal',
                        'proportional_order_value',
                        'equal_per_person',
                        'flat_per_person',
                        'item_specific',
                        'alcohol_only'
                      )),
  excluded_user_ids UUID[] NOT NULL DEFAULT '{}',
  position          INT NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_charge_expense ON charge_components(expense_id);

-- ---- expense_participants -------------------------------------------------
CREATE TABLE expense_participants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id   UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  is_included  BOOLEAN NOT NULL DEFAULT TRUE,
  owed_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
  paid_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (expense_id, user_id)
);

CREATE INDEX idx_ep_expense ON expense_participants(expense_id);
CREATE INDEX idx_ep_user    ON expense_participants(user_id);

-- ---- settlements ----------------------------------------------------------
CREATE TABLE settlements (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  from_user_id  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  to_user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  amount        NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency      CHAR(3) NOT NULL,
  status        TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed')),
  settled_at    TIMESTAMPTZ,
  note          TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (from_user_id <> to_user_id)
);

CREATE INDEX idx_settlements_group ON settlements(group_id);
CREATE INDEX idx_settlements_from  ON settlements(from_user_id);
CREATE INDEX idx_settlements_to    ON settlements(to_user_id);

CREATE TRIGGER trg_settlements_updated_at
  BEFORE UPDATE ON settlements
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---- receipt_assets -------------------------------------------------------
CREATE TABLE receipt_assets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id     UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  storage_path   TEXT NOT NULL,
  mime_type      TEXT NOT NULL DEFAULT 'image/jpeg',
  size_bytes     INT NOT NULL DEFAULT 0,
  parse_status   TEXT NOT NULL DEFAULT 'manual'
                   CHECK (parse_status IN ('manual','processing','done','failed')),
  uploaded_by    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_receipt_expense ON receipt_assets(expense_id);

CREATE TRIGGER trg_receipt_assets_updated_at
  BEFORE UPDATE ON receipt_assets
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ============================================================================
-- Helper function: is_group_member (created after group_members exists)
-- ============================================================================
-- SECURITY DEFINER bypasses RLS on group_members so policies that call this
-- function never recurse. STABLE marks it as side-effect-free within a query.
CREATE OR REPLACE FUNCTION is_group_member(gid UUID)
RETURNS BOOLEAN
LANGUAGE SQL
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM group_members
    WHERE group_id = gid AND user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION is_group_member(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION is_group_member(UUID) TO authenticated;

-- ============================================================================
-- Row Level Security
-- ============================================================================
ALTER TABLE profiles               ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members          ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses               ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_items             ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_item_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE charge_components      ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_participants   ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements            ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_assets         ENABLE ROW LEVEL SECURITY;

-- ---- profiles -------------------------------------------------------------
-- Read: self, plus profiles of users who share at least one group.
CREATE POLICY "profiles_read" ON profiles FOR SELECT TO authenticated USING (
  id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM group_members gm
    WHERE gm.user_id = profiles.id
      AND gm.group_id IN (
        SELECT group_id FROM group_members WHERE user_id = auth.uid()
      )
  )
);

CREATE POLICY "profiles_update_self" ON profiles FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- INSERT into profiles happens only via the auth trigger (SECURITY DEFINER),
-- never directly from the client. No INSERT policy is defined.
-- DELETE cascades from auth.users; no client-side DELETE policy.

-- ---- groups ---------------------------------------------------------------
CREATE POLICY "groups_read_member" ON groups FOR SELECT TO authenticated USING (
  is_group_member(id)
);

CREATE POLICY "groups_insert_creator" ON groups FOR INSERT TO authenticated WITH CHECK (
  created_by = auth.uid()
);

CREATE POLICY "groups_update_creator" ON groups FOR UPDATE TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "groups_delete_creator" ON groups FOR DELETE TO authenticated USING (
  created_by = auth.uid()
);

-- ---- group_members --------------------------------------------------------
CREATE POLICY "group_members_read" ON group_members FOR SELECT TO authenticated USING (
  user_id = auth.uid() OR is_group_member(group_id)
);

-- A user can add themselves to a group (used by the invite-code join flow).
CREATE POLICY "group_members_insert_self" ON group_members FOR INSERT TO authenticated WITH CHECK (
  user_id = auth.uid()
);

-- A user can leave a group (delete their own membership row).
CREATE POLICY "group_members_delete_self" ON group_members FOR DELETE TO authenticated USING (
  user_id = auth.uid()
);

-- ---- expenses -------------------------------------------------------------
CREATE POLICY "expenses_read_member" ON expenses FOR SELECT TO authenticated USING (
  is_group_member(group_id)
);

CREATE POLICY "expenses_insert_member" ON expenses FOR INSERT TO authenticated WITH CHECK (
  is_group_member(group_id) AND created_by = auth.uid()
);

CREATE POLICY "expenses_update_member" ON expenses FOR UPDATE TO authenticated
  USING (is_group_member(group_id))
  WITH CHECK (is_group_member(group_id));

CREATE POLICY "expenses_delete_creator" ON expenses FOR DELETE TO authenticated USING (
  is_group_member(group_id) AND created_by = auth.uid()
);

-- ---- line_items -----------------------------------------------------------
CREATE POLICY "line_items_member" ON line_items FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM expenses e
      WHERE e.id = line_items.expense_id AND is_group_member(e.group_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM expenses e
      WHERE e.id = line_items.expense_id AND is_group_member(e.group_id)
    )
  );

-- ---- line_item_participants ----------------------------------------------
CREATE POLICY "line_item_participants_member" ON line_item_participants FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM line_items li
      JOIN expenses e ON e.id = li.expense_id
      WHERE li.id = line_item_participants.line_item_id
        AND is_group_member(e.group_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM line_items li
      JOIN expenses e ON e.id = li.expense_id
      WHERE li.id = line_item_participants.line_item_id
        AND is_group_member(e.group_id)
    )
  );

-- ---- charge_components ---------------------------------------------------
CREATE POLICY "charge_components_member" ON charge_components FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM expenses e
      WHERE e.id = charge_components.expense_id AND is_group_member(e.group_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM expenses e
      WHERE e.id = charge_components.expense_id AND is_group_member(e.group_id)
    )
  );

-- ---- expense_participants -------------------------------------------------
CREATE POLICY "expense_participants_member" ON expense_participants FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM expenses e
      WHERE e.id = expense_participants.expense_id AND is_group_member(e.group_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM expenses e
      WHERE e.id = expense_participants.expense_id AND is_group_member(e.group_id)
    )
  );

-- ---- settlements ----------------------------------------------------------
CREATE POLICY "settlements_read_member" ON settlements FOR SELECT TO authenticated USING (
  is_group_member(group_id)
);

-- You can only declare a payment that you made.
CREATE POLICY "settlements_insert_payer" ON settlements FOR INSERT TO authenticated WITH CHECK (
  is_group_member(group_id) AND from_user_id = auth.uid()
);

CREATE POLICY "settlements_update_payer" ON settlements FOR UPDATE TO authenticated
  USING (is_group_member(group_id) AND from_user_id = auth.uid())
  WITH CHECK (is_group_member(group_id) AND from_user_id = auth.uid());

CREATE POLICY "settlements_delete_payer" ON settlements FOR DELETE TO authenticated USING (
  from_user_id = auth.uid()
);

-- ---- receipt_assets -------------------------------------------------------
CREATE POLICY "receipt_assets_read_member" ON receipt_assets FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM expenses e
    WHERE e.id = receipt_assets.expense_id AND is_group_member(e.group_id)
  )
);

CREATE POLICY "receipt_assets_insert_uploader" ON receipt_assets FOR INSERT TO authenticated WITH CHECK (
  uploaded_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM expenses e
    WHERE e.id = receipt_assets.expense_id AND is_group_member(e.group_id)
  )
);

CREATE POLICY "receipt_assets_update_uploader" ON receipt_assets FOR UPDATE TO authenticated
  USING (uploaded_by = auth.uid())
  WITH CHECK (uploaded_by = auth.uid());

CREATE POLICY "receipt_assets_delete_uploader" ON receipt_assets FOR DELETE TO authenticated USING (
  uploaded_by = auth.uid()
);

-- ============================================================================
-- Auth trigger: auto-create a profile row when a new auth.users row appears
-- ============================================================================
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(
      NEW.raw_user_meta_data->>'display_name',
      split_part(NEW.email, '@', 1)
    )
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
