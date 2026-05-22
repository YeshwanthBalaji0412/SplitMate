import type { SplitInput, SplitResult, SplitRule } from '@splitmate/types';
import { computeSplit } from '@splitmate/split-engine';
import { supabase } from '@/lib/supabase';
import {
  rowToCharge,
  rowToExpense,
  rowToLineItem,
  rowToParticipant,
} from '@/hooks/useBills';

export type ItemAssignment = {
  lineItemId: string;
  claimants: Array<{ userId: string; shares: number }>;
};

export type SplitApplyResult =
  | { ok: true; result: SplitResult }
  | { ok: false; error: string };

/**
 * Persist item assignments, then run the deterministic split engine and
 * write the resulting owed_amount values back to expense_participants.
 *
 * Sequence:
 *   1. Delete existing line_item_participants for this expense's items.
 *      (Idempotent: re-running assignment overwrites prior claims.)
 *   2. Insert the new assignments. Empty claimants -> nothing inserted,
 *      engine falls back to equal-split among included users at runtime.
 *   3. Re-fetch expense + items + charges + participants from the DB so
 *      we feed the engine the canonical state.
 *   4. Run computeSplit.
 *   5. UPDATE each expense_participants row with the new owed_amount.
 *
 * Returns the SplitResult so the caller can navigate directly to the
 * bill-detail screen without an extra fetch.
 */
export async function applyAssignmentsAndCompute(
  expenseId: string,
  assignments: ItemAssignment[],
): Promise<SplitApplyResult> {
  // 1. Fetch items so we know which line_item_participants to delete.
  const { data: itemRows, error: iErr } = await supabase
    .from('line_items')
    .select('id')
    .eq('expense_id', expenseId);
  if (iErr) return { ok: false, error: iErr.message };

  const itemIds = (itemRows ?? []).map((r) => r.id as string);

  // 2. Clear previous assignments (if any).
  if (itemIds.length > 0) {
    const { error: dErr } = await supabase
      .from('line_item_participants')
      .delete()
      .in('line_item_id', itemIds);
    if (dErr) return { ok: false, error: `Failed to clear prior assignments: ${dErr.message}` };
  }

  // 3. Insert new claimant rows. One row per (item, user) with their shares.
  const claimRows = assignments.flatMap((a) =>
    a.claimants
      .filter((c) => c.shares > 0)
      .map((c) => ({
        line_item_id: a.lineItemId,
        user_id: c.userId,
        shares: c.shares,
      })),
  );

  if (claimRows.length > 0) {
    const { error: cErr } = await supabase.from('line_item_participants').insert(claimRows);
    if (cErr) return { ok: false, error: `Failed to save assignments: ${cErr.message}` };
  }

  // 4. Re-fetch everything the engine needs.
  const [expRes, itemsRes, lipsRes, chargesRes, partsRes] = await Promise.all([
    supabase.from('expenses').select('*').eq('id', expenseId).maybeSingle(),
    supabase.from('line_items').select('*').eq('expense_id', expenseId).order('position'),
    itemIds.length > 0
      ? supabase.from('line_item_participants').select('*').in('line_item_id', itemIds)
      : Promise.resolve({ data: [], error: null }),
    supabase.from('charge_components').select('*').eq('expense_id', expenseId).order('position'),
    supabase.from('expense_participants').select('*').eq('expense_id', expenseId),
  ]);

  if (expRes.error || !expRes.data) {
    return { ok: false, error: expRes.error?.message ?? 'Bill not found.' };
  }

  const expense = rowToExpense(expRes.data as Record<string, unknown>);
  const lineItems = (itemsRes.data ?? []).map((r) =>
    rowToLineItem(r as Record<string, unknown>),
  );
  const lineItemParticipants = (lipsRes.data ?? []).map((r) => ({
    id: r.id as string,
    lineItemId: r.line_item_id as string,
    userId: r.user_id as string,
    shares: parseFloat(r.shares as string),
    createdAt: r.created_at as string,
  }));
  const chargeComponents = (chargesRes.data ?? []).map((r) =>
    rowToCharge(r as Record<string, unknown>),
  );
  const participants = (partsRes.data ?? []).map((r) =>
    rowToParticipant(r as Record<string, unknown>),
  );

  // 5. Build engine input + run.
  const splitRule: SplitRule = {
    id: `rule-${expenseId}`,
    expenseId,
    method: expense.splitMethod,
    overrides: {},
  };

  const engineInput: SplitInput = {
    expense,
    lineItems,
    lineItemParticipants,
    chargeComponents,
    splitRule,
    participants,
  };

  const result = computeSplit(engineInput);

  // 6. Persist computed totals back to expense_participants.
  const updates = result.byUser.map(async (u) => {
    const { error } = await supabase
      .from('expense_participants')
      .update({ owed_amount: u.totalOwed })
      .eq('expense_id', expenseId)
      .eq('user_id', u.userId);
    return error;
  });

  const updateErrors = (await Promise.all(updates)).filter((e) => e != null);
  if (updateErrors.length > 0) {
    return {
      ok: false,
      error: `Saved assignments but failed to write owed amounts: ${updateErrors[0]!.message}`,
    };
  }

  return { ok: true, result };
}
