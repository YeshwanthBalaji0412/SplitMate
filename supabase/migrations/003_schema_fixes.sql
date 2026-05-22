-- ═══════════════════════════════════════════════════════════════════════════
-- SplitMate — Migration 003: Schema Fixes
-- ═══════════════════════════════════════════════════════════════════════════
-- Implements:
--   1. settled_at column on expenses + trigger for status change to 'settled'
--   2. category column on line_items + safe check constraint
-- ═══════════════════════════════════════════════════════════════════════════

-- ─── 1. Add settled_at to expenses ──────────────────────────────────────────
ALTER TABLE expenses ADD COLUMN IF NOT EXISTS settled_at TIMESTAMPTZ DEFAULT NULL;

-- Trigger function to automatically set settled_at when status transitions to 'settled'
CREATE OR REPLACE FUNCTION set_expense_settled_at()
RETURNS TRIGGER AS $$
BEGIN
  -- Set settled_at = NOW() only when transitioning from non-settled status to 'settled'
  IF NEW.status = 'settled' AND (OLD.status IS DISTINCT FROM 'settled' OR OLD.status IS NULL) THEN
    -- Do not overwrite settled_at if it is already set
    IF NEW.settled_at IS NULL THEN
      NEW.settled_at = NOW();
    END IF;
  ELSIF NEW.status IS DISTINCT FROM 'settled' THEN
    -- Reset to NULL if status is changed back to non-settled
    NEW.settled_at = NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply trigger before update
DROP TRIGGER IF EXISTS trg_expenses_settled_at ON expenses;
CREATE TRIGGER trg_expenses_settled_at
  BEFORE UPDATE ON expenses
  FOR EACH ROW
  EXECUTE FUNCTION set_expense_settled_at();

-- ─── 2. Add category to line_items ─────────────────────────────────────────
ALTER TABLE line_items ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'other';

-- Safe drop and add CHECK constraint for idempotent executions
ALTER TABLE line_items DROP CONSTRAINT IF EXISTS chk_line_item_category;
ALTER TABLE line_items
  ADD CONSTRAINT chk_line_item_category
  CHECK (category IN ('food', 'alcohol', 'non_taxable', 'other'));
