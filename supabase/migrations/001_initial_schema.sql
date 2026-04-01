-- ═══════════════════════════════════════════════════════════════════════════
-- Split-Smart — Initial Schema (Migration 001)
-- ═══════════════════════════════════════════════════════════════════════════
-- Design principles:
--   1. Every money value is stored as NUMERIC(12,2) — exact decimal arithmetic,
--      no floating-point errors.
--   2. Row Level Security (RLS) is enabled on every table. Policies are strict:
--      users can only see data in groups they belong to.
--   3. All IDs are UUIDs. Timestamps are timestamptz (UTC).
--   4. Soft audit trail: expense_revisions stores full snapshots on change.
-- ═══════════════════════════════════════════════════════════════════════════

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ─── Helpers ─────────────────────────────────────────────────────────────────

-- Automatically update updated_at on any table that has it.
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ─── 1. Profiles ─────────────────────────────────────────────────────────────
-- Mirrors auth.users but stores display-friendly profile data.
-- Created automatically via trigger on auth.users insert.

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

-- Auto-create profile when a user signs up
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO profiles (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- ─── 2. Groups ────────────────────────────────────────────────────────────────

CREATE TYPE group_type AS ENUM ('trip', 'roommates', 'household', 'event', 'other');

CREATE TABLE groups (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  description  TEXT,
  type         group_type NOT NULL DEFAULT 'other',
  currency     CHAR(3) NOT NULL DEFAULT 'USD',  -- ISO 4217
  created_by   UUID NOT NULL REFERENCES profiles(id),
  invite_code  TEXT NOT NULL UNIQUE DEFAULT encode(gen_random_bytes(6), 'hex'),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TRIGGER trg_groups_updated_at
  BEFORE UPDATE ON groups
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 3. Group Members ─────────────────────────────────────────────────────────

CREATE TYPE member_role AS ENUM ('admin', 'member');

CREATE TABLE group_members (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id   UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  user_id    UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role       member_role NOT NULL DEFAULT 'member',
  joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (group_id, user_id)
);

CREATE INDEX idx_group_members_user ON group_members(user_id);
CREATE INDEX idx_group_members_group ON group_members(group_id);

-- ─── 4. Expenses ─────────────────────────────────────────────────────────────

CREATE TYPE expense_category AS ENUM (
  'food', 'drinks', 'transport', 'accommodation',
  'groceries', 'utilities', 'entertainment', 'shopping', 'other'
);

CREATE TYPE expense_status AS ENUM ('draft', 'active', 'settled');

CREATE TYPE split_method AS ENUM (
  'equal', 'exact', 'percentage', 'shares', 'itemized', 'hybrid'
);

CREATE TABLE expenses (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id        UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  description     TEXT,
  total_amount    NUMERIC(12,2) NOT NULL CHECK (total_amount >= 0),
  currency        CHAR(3) NOT NULL,
  category        expense_category NOT NULL DEFAULT 'other',
  paid_by         UUID NOT NULL REFERENCES profiles(id),
  date            DATE NOT NULL DEFAULT CURRENT_DATE,
  receipt_asset_id UUID,  -- FK added after receipt_assets table
  status          expense_status NOT NULL DEFAULT 'active',
  split_method    split_method NOT NULL DEFAULT 'equal',
  created_by      UUID NOT NULL REFERENCES profiles(id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_expenses_group ON expenses(group_id);
CREATE INDEX idx_expenses_paid_by ON expenses(paid_by);
CREATE INDEX idx_expenses_date ON expenses(date DESC);

CREATE TRIGGER trg_expenses_updated_at
  BEFORE UPDATE ON expenses
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ─── 5. Expense Participants ──────────────────────────────────────────────────

CREATE TABLE expense_participants (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id  UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  user_id     UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  owed_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (owed_amount >= 0),
  paid_amount NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
  is_included BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE (expense_id, user_id)
);

CREATE INDEX idx_expense_participants_expense ON expense_participants(expense_id);
CREATE INDEX idx_expense_participants_user ON expense_participants(user_id);

-- ─── 6. Line Items ────────────────────────────────────────────────────────────

CREATE TABLE line_items (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id  UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  quantity    NUMERIC(10,3) NOT NULL DEFAULT 1 CHECK (quantity > 0),
  unit_price  NUMERIC(12,2) NOT NULL CHECK (unit_price >= 0),
  total_price NUMERIC(12,2) NOT NULL CHECK (total_price >= 0),
  position    SMALLINT NOT NULL DEFAULT 0
);

CREATE INDEX idx_line_items_expense ON line_items(expense_id);

-- ─── 7. Line Item Participants ────────────────────────────────────────────────

CREATE TABLE line_item_participants (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  line_item_id UUID NOT NULL REFERENCES line_items(id) ON DELETE CASCADE,
  user_id      UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  shares       NUMERIC(10,3) NOT NULL DEFAULT 1 CHECK (shares > 0),
  UNIQUE (line_item_id, user_id)
);

-- ─── 8. Charge Components ─────────────────────────────────────────────────────

CREATE TYPE charge_type AS ENUM (
  'subtotal', 'sales_tax', 'state_tax', 'city_tax',
  'delivery_fee', 'service_fee', 'platform_fee',
  'gratuity', 'discount', 'rounding_adjustment', 'custom'
);

CREATE TYPE allocation_rule AS ENUM (
  'equal',
  'proportional_to_subtotal',
  'proportional_to_selected_items',
  'custom_fixed_amount',
  'excluded'
);

CREATE TABLE charge_components (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id       UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  type             charge_type NOT NULL,
  label            TEXT NOT NULL,
  amount           NUMERIC(12,2) NOT NULL,  -- negative for discounts
  rate             NUMERIC(8,6),            -- optional %, e.g. 0.085000 for 8.5%
  allocation_rule  allocation_rule NOT NULL DEFAULT 'equal',
  excluded_user_ids UUID[] NOT NULL DEFAULT '{}',
  position         SMALLINT NOT NULL DEFAULT 0
);

CREATE INDEX idx_charge_components_expense ON charge_components(expense_id);

-- ─── 9. Split Rules ───────────────────────────────────────────────────────────

CREATE TABLE split_rules (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id  UUID NOT NULL UNIQUE REFERENCES expenses(id) ON DELETE CASCADE,
  method      split_method NOT NULL DEFAULT 'equal',
  overrides   JSONB NOT NULL DEFAULT '{}'  -- userId → amount | percentage | shares
);

-- ─── 10. Settlements ──────────────────────────────────────────────────────────

CREATE TYPE settlement_status AS ENUM ('pending', 'completed', 'cancelled');

CREATE TABLE settlements (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id     UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  from_user_id UUID NOT NULL REFERENCES profiles(id),
  to_user_id   UUID NOT NULL REFERENCES profiles(id),
  amount       NUMERIC(12,2) NOT NULL CHECK (amount > 0),
  currency     CHAR(3) NOT NULL,
  status       settlement_status NOT NULL DEFAULT 'pending',
  notes        TEXT,
  settled_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (from_user_id != to_user_id)
);

CREATE INDEX idx_settlements_group ON settlements(group_id);
CREATE INDEX idx_settlements_from ON settlements(from_user_id);
CREATE INDEX idx_settlements_to ON settlements(to_user_id);

-- ─── 11. Receipt Assets ───────────────────────────────────────────────────────

CREATE TYPE parse_status AS ENUM ('pending', 'processing', 'done', 'failed');

CREATE TABLE receipt_assets (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id     UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  storage_path   TEXT NOT NULL,
  mime_type      TEXT NOT NULL,
  size_bytes     INTEGER NOT NULL,
  parse_status   parse_status,
  parsed_at      TIMESTAMPTZ,
  uploaded_by    UUID NOT NULL REFERENCES profiles(id),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Add FK from expenses back to receipt_assets now that the table exists
ALTER TABLE expenses
  ADD CONSTRAINT fk_receipt_asset
  FOREIGN KEY (receipt_asset_id) REFERENCES receipt_assets(id) ON DELETE SET NULL;

-- ─── 12. Expense Revisions (audit trail) ─────────────────────────────────────

CREATE TABLE expense_revisions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  expense_id  UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  revision    INTEGER NOT NULL,
  snapshot    JSONB NOT NULL,  -- full expense row at time of change
  changed_by  UUID NOT NULL REFERENCES profiles(id),
  changed_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  change_note TEXT,
  UNIQUE (expense_id, revision)
);

CREATE INDEX idx_expense_revisions_expense ON expense_revisions(expense_id);

-- Auto-snapshot on expense update
CREATE OR REPLACE FUNCTION snapshot_expense()
RETURNS TRIGGER AS $$
DECLARE
  next_rev INTEGER;
BEGIN
  SELECT COALESCE(MAX(revision), 0) + 1
    INTO next_rev
    FROM expense_revisions
   WHERE expense_id = NEW.id;

  INSERT INTO expense_revisions (expense_id, revision, snapshot, changed_by)
  VALUES (NEW.id, next_rev, row_to_json(NEW)::JSONB, NEW.created_by);

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER on_expense_updated
  AFTER UPDATE ON expenses
  FOR EACH ROW
  WHEN (OLD.* IS DISTINCT FROM NEW.*)
  EXECUTE FUNCTION snapshot_expense();

-- ═══════════════════════════════════════════════════════════════════════════
-- Row Level Security Policies
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE profiles            ENABLE ROW LEVEL SECURITY;
ALTER TABLE groups              ENABLE ROW LEVEL SECURITY;
ALTER TABLE group_members       ENABLE ROW LEVEL SECURITY;
ALTER TABLE expenses            ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_items          ENABLE ROW LEVEL SECURITY;
ALTER TABLE line_item_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE charge_components   ENABLE ROW LEVEL SECURITY;
ALTER TABLE split_rules         ENABLE ROW LEVEL SECURITY;
ALTER TABLE settlements         ENABLE ROW LEVEL SECURITY;
ALTER TABLE receipt_assets      ENABLE ROW LEVEL SECURITY;
ALTER TABLE expense_revisions   ENABLE ROW LEVEL SECURITY;

-- Helper: is the current user a member of a given group?
CREATE OR REPLACE FUNCTION is_group_member(gid UUID)
RETURNS BOOLEAN AS $$
  SELECT EXISTS (
    SELECT 1 FROM group_members
    WHERE group_id = gid AND user_id = auth.uid()
  );
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- profiles: users can read any profile, only edit their own
CREATE POLICY "profiles: read own" ON profiles
  FOR SELECT USING (id = auth.uid());

CREATE POLICY "profiles: update own" ON profiles
  FOR UPDATE USING (id = auth.uid());

-- groups: only members can see a group
CREATE POLICY "groups: members can read" ON groups
  FOR SELECT USING (is_group_member(id));

CREATE POLICY "groups: authenticated can create" ON groups
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "groups: admin can update" ON groups
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM group_members
      WHERE group_id = id AND user_id = auth.uid() AND role = 'admin'
    )
  );

-- group_members: visible to members of the same group
CREATE POLICY "group_members: members can read" ON group_members
  FOR SELECT USING (is_group_member(group_id));

CREATE POLICY "group_members: admin can manage" ON group_members
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM group_members gm
      WHERE gm.group_id = group_members.group_id
        AND gm.user_id = auth.uid()
        AND gm.role = 'admin'
    )
  );

CREATE POLICY "group_members: self join via invite" ON group_members
  FOR INSERT WITH CHECK (user_id = auth.uid());

-- expenses: visible to group members
CREATE POLICY "expenses: members can read" ON expenses
  FOR SELECT USING (is_group_member(group_id));

CREATE POLICY "expenses: members can create" ON expenses
  FOR INSERT WITH CHECK (is_group_member(group_id));

CREATE POLICY "expenses: creator or admin can update" ON expenses
  FOR UPDATE USING (
    created_by = auth.uid() OR
    EXISTS (
      SELECT 1 FROM group_members
      WHERE group_id = expenses.group_id AND user_id = auth.uid() AND role = 'admin'
    )
  );

-- expense_participants: same group membership check via expense
CREATE POLICY "expense_participants: members can read" ON expense_participants
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM expenses e
      WHERE e.id = expense_id AND is_group_member(e.group_id)
    )
  );

CREATE POLICY "expense_participants: members can manage" ON expense_participants
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM expenses e
      WHERE e.id = expense_id AND is_group_member(e.group_id)
    )
  );

-- line_items, line_item_participants, charge_components, split_rules:
-- same access pattern — scoped to expense group membership
CREATE POLICY "line_items: group members" ON line_items
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM expenses e WHERE e.id = expense_id AND is_group_member(e.group_id)
    )
  );

CREATE POLICY "line_item_participants: group members" ON line_item_participants
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM line_items li
      JOIN expenses e ON e.id = li.expense_id
      WHERE li.id = line_item_id AND is_group_member(e.group_id)
    )
  );

CREATE POLICY "charge_components: group members" ON charge_components
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM expenses e WHERE e.id = expense_id AND is_group_member(e.group_id)
    )
  );

CREATE POLICY "split_rules: group members" ON split_rules
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM expenses e WHERE e.id = expense_id AND is_group_member(e.group_id)
    )
  );

-- settlements: visible to participants
CREATE POLICY "settlements: participants can read" ON settlements
  FOR SELECT USING (
    from_user_id = auth.uid() OR to_user_id = auth.uid() OR is_group_member(group_id)
  );

CREATE POLICY "settlements: members can create" ON settlements
  FOR INSERT WITH CHECK (is_group_member(group_id));

CREATE POLICY "settlements: participants can update" ON settlements
  FOR UPDATE USING (from_user_id = auth.uid() OR to_user_id = auth.uid());

-- receipt_assets and revisions: group membership
CREATE POLICY "receipt_assets: group members" ON receipt_assets
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM expenses e WHERE e.id = expense_id AND is_group_member(e.group_id)
    )
  );

CREATE POLICY "expense_revisions: group members" ON expense_revisions
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM expenses e WHERE e.id = expense_id AND is_group_member(e.group_id)
    )
  );
