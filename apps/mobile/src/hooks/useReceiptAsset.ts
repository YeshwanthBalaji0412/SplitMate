import { useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { ParsedBillDraft } from '@split-smart/ocr-parser';

// Manages the receipt_assets row lifecycle for an expense:
//   insert (status=processing) when scan starts
//   update (status=done, parse_metadata) when parser finishes
//   update (status=failed) on error
//
// Returns the asset ID so the expense row can reference it.

export function useReceiptAsset() {
  const createAsset = useCallback(
    async (expenseId: string, imageUri: string, uploadedBy: string): Promise<string | null> => {
      const { data, error } = await supabase
        .from('receipt_assets')
        .insert({
          expense_id: expenseId,
          storage_path: imageUri, // local URI at this stage — SWE upload flow TBD
          mime_type: 'image/jpeg',
          size_bytes: 0,          // unknown until upload
          parse_status: 'processing',
          uploaded_by: uploadedBy,
        })
        .select('id')
        .single();

      if (error || !data) return null;
      return data.id;
    },
    []
  );

  const markDone = useCallback(
    async (assetId: string, draft: ParsedBillDraft): Promise<void> => {
      await supabase
        .from('receipt_assets')
        .update({
          parse_status: 'done',
          parsed_at: new Date().toISOString(),
          parse_metadata: {
            confidenceScores: draft.confidenceScores,
            flaggedFields: draft.flaggedFields,
            merchantName: draft.merchantName,
            date: draft.date,
            itemCount: draft.items.length,
            chargeCount: draft.charges.length,
          },
        })
        .eq('id', assetId);
    },
    []
  );

  const markFailed = useCallback(async (assetId: string, reason: string): Promise<void> => {
    await supabase
      .from('receipt_assets')
      .update({ parse_status: 'failed', parse_metadata: { error: reason } })
      .eq('id', assetId);
  }, []);

  return { createAsset, markDone, markFailed };
}
