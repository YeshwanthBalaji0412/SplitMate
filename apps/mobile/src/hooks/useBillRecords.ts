import { useCallback, useEffect, useState } from 'react';
import type { BillRecord } from '@splitmate/analytics';
import { supabase } from '@/lib/supabase';

/**
 * Fetches expenses where the current user is a participant within a
 * date window, then maps the DB rows into BillRecord[] for the
 * analytics package. No analytics logic runs inside this hook — it's
 * a pure data-fetching adapter.
 */
export function useBillRecords(
  userId: string | undefined,
  window?: { from: string; to: string },
) {
  const [records, setRecords] = useState<BillRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) {
      setRecords([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    // Step 1: find expense_ids where user is a participant.
    const { data: epRows, error: epErr } = await supabase
      .from('expense_participants')
      .select('expense_id')
      .eq('user_id', userId);
    if (epErr) { setError(epErr.message); setLoading(false); return; }

    const expenseIds = [...new Set((epRows ?? []).map((r) => r.expense_id as string))];
    if (expenseIds.length === 0) { setRecords([]); setLoading(false); return; }

    // Step 2: fetch expenses (with optional date window).
    let query = supabase
      .from('expenses')
      .select('id, group_id, title, date, bill_type, total_amount, currency, status, settled_at, updated_at')
      .in('id', expenseIds)
      .order('date', { ascending: false });

    if (window) {
      query = query.gte('date', window.from).lte('date', window.to);
    }

    const { data: expRows, error: eErr } = await query;
    if (eErr) { setError(eErr.message); setLoading(false); return; }
    if (!expRows || expRows.length === 0) { setRecords([]); setLoading(false); return; }

    const finalIds = expRows.map((e) => e.id as string);

    // Step 3: fetch participants + items for these expenses.
    const [partRes, itemsRes] = await Promise.all([
      supabase.from('expense_participants').select('expense_id, user_id, owed_amount, paid_amount').in('expense_id', finalIds),
      supabase.from('line_items').select('expense_id, name, total_price, category').in('expense_id', finalIds),
    ]);

    const partByExp = groupBy((partRes.data ?? []) as Array<Record<string, unknown>>, 'expense_id');
    const itemsByExp = groupBy((itemsRes.data ?? []) as Array<Record<string, unknown>>, 'expense_id');

    // Step 4: assemble BillRecord[].
    const mapped: BillRecord[] = expRows.map((exp) => {
      const eid = exp.id as string;
      return {
        id: eid,
        date: exp.date as string,
        title: exp.title as string,
        billType: exp.bill_type as string,
        totalAmount: parseFloat(exp.total_amount as string),
        currency: exp.currency as string,
        status: exp.status as string,
        settledAt: (exp.settled_at as string | null)
          ?? (exp.status === 'settled' ? (exp.updated_at as string | null)?.slice(0, 10) ?? null : null),
        participants: (partByExp[eid] ?? []).map((p) => ({
          userId: p.user_id as string,
          owedAmount: parseFloat(p.owed_amount as string),
          paidAmount: parseFloat(p.paid_amount as string),
        })),
        items: (itemsByExp[eid] ?? []).map((i) => ({
          name: i.name as string,
          totalPrice: parseFloat(i.total_price as string),
          category: (i.category as string) ?? 'other',
        })),
      };
    });

    setRecords(mapped);
    setLoading(false);
  }, [userId, window?.from, window?.to]);

  useEffect(() => { load(); }, [load]);

  return { records, loading, error, refresh: load };
}

function groupBy<T extends Record<string, unknown>>(arr: T[], key: string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const item of arr) {
    const k = item[key] as string;
    (out[k] ??= []).push(item);
  }
  return out;
}
