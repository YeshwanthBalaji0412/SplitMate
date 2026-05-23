import { supabase } from '@/lib/supabase';

/**
 * Upload a receipt image to Supabase Storage (`receipts` bucket) and
 * persist a matching `receipt_assets` row pointing at the real storage
 * path (NOT a local file:// URI).
 *
 * Two-step flow:
 *   1. PUT the blob to storage at `${expenseId}/${timestamp}.${ext}`.
 *      RLS on storage.objects requires `bucket_id='receipts'` AND auth user.
 *   2. INSERT into receipt_assets with `storage_path=<the real key>`.
 *      RLS on receipt_assets requires the inserter to be uploaded_by AND a
 *      member of the expense's group (migration 001).
 *
 * No UI wiring in Phase 10 -- this hook is consumed in Phase 13 when the
 * OCR scan flow lands a receipt image in the bill-entry form.
 */

export type UploadReceiptInput = {
  expenseId: string;
  /** Image bytes. On native this comes from expo-file-system or a Blob.
   *  On web it's the File from <input> or a fetched blob. */
  blob: Blob;
  /** Defaults to image/jpeg. Receipts from camera/picker are typically JPEG. */
  mimeType?: string;
};

export type UploadReceiptResult =
  | { ok: true; receiptAssetId: string; storagePath: string }
  | { ok: false; error: string };

function extFromMime(mime: string): string {
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('heic') || mime.includes('heif')) return 'heic';
  return 'jpg';
}

export async function uploadReceipt(input: UploadReceiptInput): Promise<UploadReceiptResult> {
  const { expenseId, blob } = input;
  const mimeType = input.mimeType ?? 'image/jpeg';

  if (!expenseId) return { ok: false, error: 'expenseId is required.' };
  if (!blob || blob.size === 0) return { ok: false, error: 'Image is empty.' };

  const { data: sessionData } = await supabase.auth.getUser();
  const userId = sessionData.user?.id;
  if (!userId) return { ok: false, error: 'Not signed in.' };

  // Path layout: groups can read receipts by walking
  //   storage.objects.name -> receipt_assets.storage_path -> expense -> group.
  // Putting expenseId in the path is convenient for ad-hoc inspection but
  // does NOT grant access -- access still goes through the join.
  const storagePath = `${expenseId}/${Date.now()}.${extFromMime(mimeType)}`;

  // 1. Upload to Storage.
  const { data: uploadData, error: uploadErr } = await supabase.storage
    .from('receipts')
    .upload(storagePath, blob, {
      contentType: mimeType,
      upsert: false,
    });
  if (uploadErr || !uploadData) {
    return { ok: false, error: uploadErr?.message ?? 'Storage upload failed.' };
  }

  // 2. Insert the matching DB row.
  const { data: assetRow, error: insertErr } = await supabase
    .from('receipt_assets')
    .insert({
      expense_id: expenseId,
      storage_path: storagePath,
      mime_type: mimeType,
      size_bytes: blob.size,
      parse_status: 'manual', // Phase 13 (OCR) will set this to 'processing'
      uploaded_by: userId,
    })
    .select('id')
    .single();

  if (insertErr || !assetRow) {
    // Best-effort cleanup: orphan blob is harmless but wastes space.
    await supabase.storage.from('receipts').remove([storagePath]).catch(() => {});
    return { ok: false, error: insertErr?.message ?? 'Failed to register receipt.' };
  }

  return { ok: true, receiptAssetId: assetRow.id as string, storagePath };
}

/**
 * After a successful scan + bill creation, write parse_metadata back
 * to the receipt_assets row for the expense. If no receipt_assets row
 * exists yet (manual entry without upload), this is a no-op.
 */
export type ParseMetadata = {
  confidenceScores: Record<string, number>;
  flaggedFields: string[];
  itemCount: number;
  chargeCount: number;
};

export async function markReceiptDone(
  expenseId: string,
  metadata: ParseMetadata,
): Promise<void> {
  await supabase
    .from('receipt_assets')
    .update({
      parse_status: 'done',
      parse_metadata: metadata,
    })
    .eq('expense_id', expenseId);
}

export async function markReceiptFailed(
  expenseId: string,
  reason: string,
): Promise<void> {
  await supabase
    .from('receipt_assets')
    .update({
      parse_status: 'failed',
      parse_metadata: { error: reason },
    })
    .eq('expense_id', expenseId);
}

/**
 * Generate a short-lived signed URL for viewing a receipt. Useful for
 * rendering a thumbnail in bill detail (private bucket -- can't use a
 * public URL). Default TTL is 1 hour.
 */
export async function getReceiptSignedUrl(
  storagePath: string,
  expiresInSec = 3600,
): Promise<string | null> {
  const { data, error } = await supabase.storage
    .from('receipts')
    .createSignedUrl(storagePath, expiresInSec);
  if (error || !data) return null;
  return data.signedUrl;
}
