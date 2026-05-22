import { useCallback, useEffect, useState } from 'react';
import type { ExpenseDebt, SettlementMode, TraceableTransfer } from '@splitmate/types';
import { computeGroupSettlement } from '@splitmate/split-engine';
import { supabase } from '@/lib/supabase';
import { useGroup } from '@/hooks/useGroups';

/**
 * Computes the outstanding transfers for a group and exposes a `markPaid`
 * action.
 *
 * Flow inside `load()`:
 *   1. Fetch all `active` expenses in the group.
 *   2. Fetch their participants (with owed_amount).
 *   3. Fetch already-completed settlement_expense_links so we can subtract
 *      amounts each debtor has already paid toward each expense.
 *   4. Build ExpenseDebt[] (excludes payer, drops fully-paid atoms).
 *   5. Run computeGroupSettlement (optimized or direct, per group setting).
 *
 * markPaid():
 *   1. INSERT settlement (status='completed', settled_at=NOW()).
 *   2. INSERT settlement_expense_links for each contributing source bill.
 *   3. For each linked expense, recompute coverage. If fully covered,
 *      UPDATE expense status to 'settled' (trigger sets settled_at).
 *   4. Refresh local state.
 *
 * Atomicity caveat: this is a sequence of client-side calls, not a single
 * RPC. Partial failure can leave a settlement without all its links or
 * miss the expense-status flip. The risk is low and the error surfaces
 * to the user; a future migration can promote this to a SECURITY DEFINER
 * RPC if needed.
 */
export function useGroupSettlement(groupId: string | undefined) {
  const { group } = useGroup(groupId);
  const [transfers, setTransfers] = useState<TraceableTransfer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!groupId || !group) {
      setTransfers([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    // 1. Active expenses in this group
    const { data: expenseRows, error: eErr } = await supabase
      .from('expenses')
      .select('id, paid_by')
      .eq('group_id', groupId)
      .eq('status', 'active');
    if (eErr) {
      setError(eErr.message);
      setLoading(false);
      return;
    }

    if (!expenseRows || expenseRows.length === 0) {
      setTransfers([]);
      setLoading(false);
      return;
    }

    const expenseIds = expenseRows.map((e) => e.id as string);

    // 2. Participants across all those expenses
    const { data: partRows } = await supabase
      .from('expense_participants')
      .select('expense_id, user_id, owed_amount, is_included')
      .in('expense_id', expenseIds);

    // 3. Already-paid amounts per (debtor, expense)
    const { data: linkRows } = await supabase
      .from('settlement_expense_links')
      .select('expense_id, amount_from_expense, settlement:settlements(from_user_id, status, group_id)')
      .in('expense_id', expenseIds);

    // Build paid-so-far map: key `${expenseId}|${userId}` -> amount
    const paidByPair = new Map<string, number>();
    for (const row of linkRows ?? []) {
      const sRaw = (row as { settlement: unknown }).settlement;
      const s = (Array.isArray(sRaw) ? sRaw[0] : sRaw) as
        | { from_user_id: string; status: string; group_id: string }
        | undefined;
      if (!s || s.status !== 'completed' || s.group_id !== groupId) continue;
      const key = `${row.expense_id}|${s.from_user_id}`;
      const cur = paidByPair.get(key) ?? 0;
      paidByPair.set(key, cur + parseFloat(row.amount_from_expense as unknown as string));
    }

    // 4. Build ExpenseDebt[] for the engine
    const debts: ExpenseDebt[] = expenseRows
      .map((exp) => {
        const expenseId = exp.id as string;
        const paidBy = exp.paid_by as string;
        const breakdown = (partRows ?? [])
          .filter((p) => p.expense_id === expenseId)
          .filter((p) => p.is_included === true)
          .filter((p) => (p.user_id as string) !== paidBy)
          .map((p) => {
            const owed = parseFloat(p.owed_amount as unknown as string);
            const alreadyPaid = paidByPair.get(`${expenseId}|${p.user_id}`) ?? 0;
            const remaining = Math.round((owed - alreadyPaid) * 100) / 100;
            return { userId: p.user_id as string, totalOwed: Math.max(0, remaining) };
          })
          .filter((b) => b.totalOwed > 0.005);
        return { expenseId, paidBy, breakdown };
      })
      .filter((d) => d.breakdown.length > 0);

    // 5. Run engine
    const result = computeGroupSettlement(debts, group.settlementMode as SettlementMode, group.currency);
    setTransfers(result.transfers);
    setLoading(false);
  }, [groupId, group]);

  useEffect(() => {
    load();
  }, [load]);

  return { transfers, loading, error, refresh: load };
}

export type MarkPaidResult = { ok: true; settlementId: string } | { ok: false; error: string };

/**
 * Persist a transfer as a completed settlement, write its source-bill
 * links, and flip any fully-covered expenses to `settled`.
 */
export async function markTransferPaid(
  transfer: TraceableTransfer,
  groupId: string,
): Promise<MarkPaidResult> {
  const { data: sessionData } = await supabase.auth.getUser();
  const userId = sessionData.user?.id;
  if (!userId) return { ok: false, error: 'Not signed in.' };
  if (userId !== transfer.fromUserId) {
    return { ok: false, error: 'Only the payer can mark this transfer as paid.' };
  }

  // 1. Insert the settlement row.
  const { data: settlementRow, error: sErr } = await supabase
    .from('settlements')
    .insert({
      group_id: groupId,
      from_user_id: transfer.fromUserId,
      to_user_id: transfer.toUserId,
      amount: transfer.amount,
      currency: transfer.currency,
      status: 'completed',
      settled_at: new Date().toISOString(),
    })
    .select('id')
    .single();

  if (sErr || !settlementRow) {
    return { ok: false, error: sErr?.message ?? 'Failed to create settlement.' };
  }
  const settlementId = settlementRow.id as string;

  // 2. Insert source-bill traceability links.
  if (transfer.expenseLinks.length > 0) {
    const linkRows = transfer.expenseLinks.map((l) => ({
      settlement_id: settlementId,
      expense_id: l.expenseId,
      amount_from_expense: l.amount,
    }));
    const { error: lErr } = await supabase.from('settlement_expense_links').insert(linkRows);
    if (lErr) {
      // Settlement was created but links failed. Surface the error;
      // the user can re-run settlement after manually cleaning up.
      return { ok: false, error: `Settlement saved but links failed: ${lErr.message}` };
    }
  }

  // 3. For each linked expense, check if fully covered and flip status.
  for (const link of transfer.expenseLinks) {
    await maybeMarkExpenseSettled(link.expenseId);
  }

  return { ok: true, settlementId };
}

/**
 * Compute whether an expense is fully covered by completed settlement
 * links. If yes, flip its status to 'settled' (trigger writes settled_at).
 *
 * Defined as: sum of `amount_from_expense` for completed links >= total
 * non-payer owed_amount, minus a 1-cent tolerance for float drift.
 *
 * Known limitation: in optimized mode, transfers can reroute through the
 * graph (A->B->C becomes A->C). When that happens, the underlying B->C
 * atom is never directly settled, so its source expense may stay 'active'
 * even after group-wide net balance is zero. Direct mode + simple cases
 * always settle cleanly.
 */
async function maybeMarkExpenseSettled(expenseId: string): Promise<void> {
  // Pull all completed links for this expense.
  const { data: linkData } = await supabase
    .from('settlement_expense_links')
    .select('amount_from_expense, settlement:settlements(status)')
    .eq('expense_id', expenseId);

  const totalSettled = (linkData ?? [])
    .filter((r) => {
      const sRaw = (r as { settlement: unknown }).settlement;
      const s = (Array.isArray(sRaw) ? sRaw[0] : sRaw) as { status: string } | undefined;
      return s?.status === 'completed';
    })
    .reduce((s, r) => s + parseFloat(r.amount_from_expense as unknown as string), 0);

  // Total non-payer owed_amount.
  const { data: expRow } = await supabase
    .from('expenses')
    .select('paid_by')
    .eq('id', expenseId)
    .maybeSingle();
  if (!expRow) return;

  const { data: partData } = await supabase
    .from('expense_participants')
    .select('user_id, owed_amount')
    .eq('expense_id', expenseId);

  const totalOwed = (partData ?? [])
    .filter((p) => (p.user_id as string) !== (expRow.paid_by as string))
    .reduce((s, p) => s + parseFloat(p.owed_amount as unknown as string), 0);

  if (totalSettled >= totalOwed - 0.01 && totalOwed > 0) {
    await supabase.from('expenses').update({ status: 'settled' }).eq('id', expenseId);
    // trg_expenses_settled_at sets settled_at on this UPDATE.
  }
}
