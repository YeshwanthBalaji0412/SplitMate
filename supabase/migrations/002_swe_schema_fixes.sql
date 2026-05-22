-- ============================================================================
-- SplitMate -- Migration 002: SWE Schema Fixes
-- ----------------------------------------------------------------------------
-- Additive changes to support MVP features that weren't in 001:
--   * groups.country               -- India / USA tax + parsing mode
--   * groups.settlement_mode       -- optimized vs direct
--   * expenses.bill_type           -- restaurant, delivery, grocery, ...
--   * expenses.input_source        -- ocr / manual / upload
--   * receipt_assets.parse_metadata -- OCR confidence + flagged_fields blob
--   * settlement_expense_links     -- traceability of each settlement
--   * bill_rule_templates          -- saved split rules for recurring bills
--
-- All ALTERs use IF NOT EXISTS so re-running is safe.
-- ============================================================================

-- ---- groups: country + settlement_mode ------------------------------------
ALTER TABLE groups
  ADD COLUMN IF NOT EXISTS country CHAR(2) NOT NULL DEFAULT 'US';

ALTER TABLE groups DROP CONSTRAINT IF EXISTS chk_groups_country;
ALTER TABLE groups
  ADD CONSTRAINT chk_groups_country CHECK (country IN ('IN', 'US'));

ALTER TABLE groups
  ADD COLUMN IF NOT EXISTS settlement_mode TEXT NOT NULL DEFAULT 'optimized';

ALTER TABLE groups DROP CONSTRAINT IF EXISTS chk_groups_settlement_mode;
ALTER TABLE groups
  ADD CONSTRAINT chk_groups_settlement_mode
  CHECK (settlement_mode IN ('optimized', 'direct'));

-- ---- expenses: bill_type + input_source -----------------------------------
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS bill_type TEXT NOT NULL DEFAULT 'custom';

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS chk_expenses_bill_type;
ALTER TABLE expenses
  ADD CONSTRAINT chk_expenses_bill_type
  CHECK (bill_type IN (
    'restaurant', 'grocery', 'delivery',
    'utility', 'subscription', 'accommodation', 'custom'
  ));

ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS input_source TEXT NOT NULL DEFAULT 'manual';

ALTER TABLE expenses DROP CONSTRAINT IF EXISTS chk_expenses_input_source;
ALTER TABLE expenses
  ADD CONSTRAINT chk_expenses_input_source
  CHECK (input_source IN ('ocr', 'manual', 'upload'));

-- ---- receipt_assets: parse_metadata --------------------------------------
ALTER TABLE receipt_assets
  ADD COLUMN IF NOT EXISTS parse_metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

-- ============================================================================
-- settlement_expense_links -- traceability from a settlement back to bills
-- ============================================================================
CREATE TABLE IF NOT EXISTS settlement_expense_links (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  settlement_id        UUID NOT NULL REFERENCES settlements(id) ON DELETE CASCADE,
  expense_id           UUID NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
  amount_from_expense  NUMERIC(12,2) NOT NULL CHECK (amount_from_expense > 0),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (settlement_id, expense_id)
);

CREATE INDEX IF NOT EXISTS idx_sel_settlement ON settlement_expense_links(settlement_id);
CREATE INDEX IF NOT EXISTS idx_sel_expense    ON settlement_expense_links(expense_id);

ALTER TABLE settlement_expense_links ENABLE ROW LEVEL SECURITY;

-- Anyone in the group can see the trace.
DROP POLICY IF EXISTS "sel_read_member" ON settlement_expense_links;
CREATE POLICY "sel_read_member" ON settlement_expense_links FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM settlements s
    WHERE s.id = settlement_expense_links.settlement_id
      AND is_group_member(s.group_id)
  )
);

-- Only the payer (from_user_id of the parent settlement) can write links.
DROP POLICY IF EXISTS "sel_write_payer" ON settlement_expense_links;
CREATE POLICY "sel_write_payer" ON settlement_expense_links FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM settlements s
      WHERE s.id = settlement_expense_links.settlement_id
        AND s.from_user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM settlements s
      WHERE s.id = settlement_expense_links.settlement_id
        AND s.from_user_id = auth.uid()
    )
  );

-- ============================================================================
-- bill_rule_templates -- saved split rules for utility/subscription bills
-- ============================================================================
CREATE TABLE IF NOT EXISTS bill_rule_templates (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id    UUID NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  bill_type   TEXT NOT NULL,
  name        TEXT NOT NULL,
  rules       JSONB NOT NULL,
  created_by  UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE bill_rule_templates DROP CONSTRAINT IF EXISTS chk_brt_bill_type;
ALTER TABLE bill_rule_templates
  ADD CONSTRAINT chk_brt_bill_type
  CHECK (bill_type IN (
    'restaurant', 'grocery', 'delivery',
    'utility', 'subscription', 'accommodation', 'custom'
  ));

CREATE INDEX IF NOT EXISTS idx_brt_group ON bill_rule_templates(group_id);

DROP TRIGGER IF EXISTS trg_brt_updated_at ON bill_rule_templates;
CREATE TRIGGER trg_brt_updated_at
  BEFORE UPDATE ON bill_rule_templates
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

ALTER TABLE bill_rule_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "brt_member" ON bill_rule_templates;
CREATE POLICY "brt_member" ON bill_rule_templates FOR ALL TO authenticated
  USING (is_group_member(group_id))
  WITH CHECK (is_group_member(group_id) AND created_by = auth.uid());
