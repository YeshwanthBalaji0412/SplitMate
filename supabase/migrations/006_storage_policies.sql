-- ============================================================================
-- SplitMate -- Migration 006: Receipt Storage Bucket + Policies
-- ----------------------------------------------------------------------------
-- Receipt images live in a PRIVATE Supabase Storage bucket. Access is gated
-- by RLS on `storage.objects` (Storage uses RLS too).
--
-- Policies on `storage.objects`:
--   1. read:    uploader OR member of the parent expense's group
--   2. insert:  any authenticated user (the receipt_assets row that
--               points at the file has stricter RLS already)
--   3. update:  only the uploader (storage.objects.owner = auth.uid())
--   4. delete:  only the uploader
--
-- The membership check joins back to `receipt_assets` via storage_path.
-- The uploader-only fallback covers the brief window where the object
-- is uploaded but the `receipt_assets` DB row hasn't been written yet.
--
-- Bucket creation: also done here via SQL so the schema is fully
-- reproducible. The Dashboard "Create bucket" UI is documented in the
-- final report as an alternative if SQL bucket creation is restricted.
-- ============================================================================

-- ---- Bucket ----------------------------------------------------------------
INSERT INTO storage.buckets (id, name, public)
VALUES ('receipts', 'receipts', false)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- ---- Drop pre-existing policies so the migration is idempotent ------------
DROP POLICY IF EXISTS "receipts_read"   ON storage.objects;
DROP POLICY IF EXISTS "receipts_insert" ON storage.objects;
DROP POLICY IF EXISTS "receipts_update" ON storage.objects;
DROP POLICY IF EXISTS "receipts_delete" ON storage.objects;

-- ---- Read ------------------------------------------------------------------
-- Uploader can always read their own object (race-safe during upload before
-- the receipt_assets row exists). Anyone in the expense's group can read
-- once the DB row is in place.
CREATE POLICY "receipts_read" ON storage.objects FOR SELECT TO authenticated USING (
  bucket_id = 'receipts'
  AND (
    owner = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM receipt_assets ra
      JOIN expenses e ON e.id = ra.expense_id
      WHERE ra.storage_path = storage.objects.name
        AND is_group_member(e.group_id)
    )
  )
);

-- ---- Insert ----------------------------------------------------------------
-- Any authenticated user can upload to the receipts bucket. The follow-up
-- `INSERT INTO receipt_assets` is gated by group membership at the DB
-- table's existing RLS, so we don't double-check it here.
CREATE POLICY "receipts_insert" ON storage.objects FOR INSERT TO authenticated WITH CHECK (
  bucket_id = 'receipts'
);

-- ---- Update + Delete -------------------------------------------------------
CREATE POLICY "receipts_update" ON storage.objects FOR UPDATE TO authenticated USING (
  bucket_id = 'receipts' AND owner = auth.uid()
);

CREATE POLICY "receipts_delete" ON storage.objects FOR DELETE TO authenticated USING (
  bucket_id = 'receipts' AND owner = auth.uid()
);
