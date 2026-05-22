-- ============================================================================
-- SplitMate -- Migration 003: Schema Fixes
-- ----------------------------------------------------------------------------
-- Two surgical additions needed for accurate analytics and tax allocation:
--   1. expenses.settled_at -- exact moment a bill was fully settled, set by
--      a trigger when status transitions to 'settled'. Never overwritten if
--      a value is already present, so an explicit user-set timestamp wins.
--   2. line_items.category -- per-item category so the engine can do
--      alcohol-tax and category-scoped tax allocation correctly.
--
-- Idempotent: ALTER ... ADD COLUMN IF NOT EXISTS + DROP/ADD CONSTRAINT.
-- ============================================================================

-- ---- 1. expenses.settled_at ----------------------------------------------
ALTER TABLE expenses
  ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ DEFAULT NULL;

CREATE OR REPLACE FUNCTION set_expense_settled_at()
RETURNS TRIGGER AS $$
BEGIN
  -- Stamp settled_at when status is 'settled' and the column is still empty.
  -- Don't overwrite if it's already set (user-supplied historical timestamp
  -- or a previous trigger run wins).
  IF NEW.status = 'settled' AND NEW.settled_at IS NULL THEN
    NEW.settled_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_expenses_settled_at ON expenses;
CREATE TRIGGER trg_expenses_settled_at
  BEFORE INSERT OR UPDATE OF status, settled_at ON expenses
  FOR EACH ROW
  EXECUTE FUNCTION set_expense_settled_at();

-- ---- 2. line_items.category ----------------------------------------------
ALTER TABLE line_items
  ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'other';

ALTER TABLE line_items DROP CONSTRAINT IF EXISTS chk_line_items_category;
ALTER TABLE line_items
  ADD CONSTRAINT chk_line_items_category
  CHECK (category IN ('food', 'alcohol', 'non_taxable', 'other'));
