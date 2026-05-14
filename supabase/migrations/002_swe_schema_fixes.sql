-- ═══════════════════════════════════════════════════════════════════════════
-- SplitMate — Migration 002: SWE Schema Fixes
-- ═══════════════════════════════════════════════════════════════════════════
-- Resolves 5 blockers flagged in SWE.md:
--   1. country on groups (tax rule engine + OCR parsing mode)
--   2. bill_type on expenses (fee rule templates + OCR mode)
--   3. settlement_expense_links (settlement traceability)
--   4. bill_rule_templates (utility/subscription recurring rules)
--   5. settlement_mode on groups (optimized vs direct toggle)
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Add country to groups ─────────────────────────────────────────────────
-- Drives tax rule engine (GST vs sales tax) and OCR parsing mode (IN vs US).
-- Constrained to supported markets only.

CREATE TYPE country_code AS ENUM ('IN', 'US');

ALTER TABLE groups
  ADD COLUMN country country_code NOT NULL DEFAULT 'US';

-- ─── 2. Add bill_type to expenses ────────────────────────────────────────────
-- Distinct from category — bill_type drives fee rule templates and OCR mode,
-- category is for analytics grouping. A "restaurant" bill_type can have
-- category "food" or "drinks"; these are orthogonal.

CREATE TYPE bill_type AS ENUM (
  'restaurant',
  'grocery',
  'delivery',
  'accommodation',
  'utility',
  'subscription',
  'custom'
);

ALTER TABLE expenses
  ADD COLUMN bill_type bill_type NOT NULL DEFAULT 'custom';

-- ─── 3. Settlement expense links (traceability) ──────────────────────────────
-- Links each settlement to the source expenses that created the debt.
-- Enables: "You owe Priya ₹640 — ₹340 from dinner May 3, ₹300 from groceries May 7"

CREATE TABLE settlement_expense_links (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id         UUID NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  expense_id            UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  amount_from_expense   NUMERIC(12,2) NOT NULL CHECK (amount_from_expense > 0),
  UNIQUE (settlement_id, expense_id)
);

CREATE INDEX idx_sel_settlement ON settlement_expense_links(settlement_id);
CREATE INDEX idx_sel_expense ON settlement_expense_links(expense_id);

-- RLS
ALTER TABLE settlement_expense_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "settlement_expense_links: group members" ON settlement_expense_links
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM settlements s
      WHERE s.id = settlement_id AND is_group_member(s.group_id)
    )
  );

-- ─── 4. Bill rule templates (recurring rules) ────────────────────────────────
-- Users set split rules once per group per bill type (e.g. utility split by room %).
-- New bills of that type auto-apply the template. Eliminates monthly re-entry.

CREATE TABLE bill_rule_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  bill_type   bill_type NOT NULL,
  name        TEXT NOT NULL,
  rules       JSONB NOT NULL DEFAULT '{}',
  created_by  UUID NOT NULL REFERENCES profiles(id),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (group_id, bill_type, name)
);

CREATE INDEX idx_brt_group ON bill_rule_templates(group_id);
CREATE INDEX idx_brt_group_type ON bill_rule_templates(group_id, bill_type);

CREATE TRIGGER trg_bill_rule_templates_updated_at
  BEFORE UPDATE ON bill_rule_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS
ALTER TABLE bill_rule_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "bill_rule_templates: group members can read" ON bill_rule_templates
  FOR SELECT USING (is_group_member(group_id));

CREATE POLICY "bill_rule_templates: members can create" ON bill_rule_templates
  FOR INSERT WITH CHECK (is_group_member(group_id));

CREATE POLICY "bill_rule_templates: creator or admin can update" ON bill_rule_templates
  FOR UPDATE USING (
    created_by = auth.uid() OR
    EXISTS (
      SELECT 1 FROM group_members
      WHERE group_id = bill_rule_templates.group_id
        AND user_id = auth.uid()
        AND role = 'admin'
    )
  );

CREATE POLICY "bill_rule_templates: creator or admin can delete" ON bill_rule_templates
  FOR DELETE USING (
    created_by = auth.uid() OR
    EXISTS (
      SELECT 1 FROM group_members
      WHERE group_id = bill_rule_templates.group_id
        AND user_id = auth.uid()
        AND role = 'admin'
    )
  );

-- ─── 5. Add settlement_mode to groups ─────────────────────────────────────────
-- Optimized (default): minimize transactions via settlement optimizer.
-- Direct: each person pays exactly who they owe per expense, no redirection.

CREATE TYPE settlement_mode AS ENUM ('optimized', 'direct');

ALTER TABLE groups
  ADD COLUMN settlement_mode settlement_mode NOT NULL DEFAULT 'optimized';
