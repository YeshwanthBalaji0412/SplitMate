import { useCallback } from 'react';
import { Alert } from 'react-native';
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
      try {
        // Fetch local image URI and convert to a binary blob for upload
        const response = await fetch(imageUri);
        const blob = await response.blob();
        const sizeBytes = blob.size;

        const filename = `${expenseId}-${Date.now()}.jpg`;

        // Upload the actual receipt image to Supabase Storage bucket 'receipts'
        // NOTE: For demo, a public bucket is acceptable.
        // PRODUCTION NOTE: In a production environment, we should use private storage
        // with restricted access policies and generate short-lived signed URLs for security.
        const { data: uploadData, error: uploadError } = await supabase.storage
          .from('receipts')
          .upload(filename, blob, {
            contentType: 'image/jpeg',
            upsert: true,
          });

        if (uploadError || !uploadData) {
          throw new Error(uploadError?.message ?? 'Failed to upload image to Supabase storage.');
        }

        const { data, error } = await supabase
          .from('receipt_assets')
          .insert({
            expense_id: expenseId,
            storage_path: uploadData.path, // store the real Supabase storage path
            mime_type: 'image/jpeg',
            size_bytes: sizeBytes,
            parse_status: 'processing',
            uploaded_by: uploadedBy,
          })
          .select('id')
          .single();

        if (error || !data) {
          throw new Error(error?.message ?? 'Failed to insert receipt asset record.');
        }

        return data.id;
      } catch (err: any) {
        Alert.alert('Receipt Upload Failed', err?.message ?? 'An error occurred during receipt upload.');
        return null;
      }
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
