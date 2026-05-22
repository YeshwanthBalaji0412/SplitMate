import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { BillRecord, BillCategory, ItemCategory } from '@split-smart/analytics';

export interface BillWindow {
  from: string;  // ISO date YYYY-MM-DD
  to: string;
}

// DB bill_type → analytics BillCategory.
// 'utility' (DB singular) → 'utilities' (analytics plural).
function toBillCategory(dbType: string): BillCategory {
  const map: Record<string, BillCategory> = {
    restaurant: 'restaurant',
    grocery: 'grocery',
    delivery: 'delivery',
    utility: 'utilities',
    accommodation: 'accommodation',
    subscription: 'subscription',
    custom: 'custom',
  };
  return map[dbType] ?? 'custom';
}

type FetchState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; records: BillRecord[] }
  | { status: 'error'; message: string };

export function useBillRecords() {
  const [state, setState] = useState<FetchState>({ status: 'idle' });

  const fetch = useCallback(async (userId: string, window: BillWindow) => {
    setState({ status: 'loading' });

    // Step 1 — get expense IDs where this user is a participant.
    const { data: participations, error: pErr } = await supabase
      .from('expense_participants')
      .select('expense_id')
      .eq('user_id', userId);

    if (pErr) { setState({ status: 'error', message: pErr.message }); return; }

    const expenseIds = (participations ?? []).map((p: { expense_id: string }) => p.expense_id);
    if (expenseIds.length === 0) { setState({ status: 'done', records: [] }); return; }

    // Step 2 — fetch those expenses with all nested data in the window.
    const { data: expenses, error: eErr } = await supabase
      .from('expenses')
      .select(`
        id, group_id, date, bill_type, total_amount, currency, status, updated_at, settled_at,
        expense_participants ( user_id, owed_amount, paid_amount ),
        line_items (
          id, name, total_price, category,
          line_item_participants ( user_id )
        )
      `)
      .in('id', expenseIds)
      .gte('date', window.from)
      .lte('date', window.to)
      .neq('status', 'draft');

    if (eErr) { setState({ status: 'error', message: eErr.message }); return; }

    const records: BillRecord[] = (expenses ?? []).map((exp: any) => ({
      id: exp.id,
      groupId: exp.group_id,
      date: exp.date,
      billType: toBillCategory(exp.bill_type),
      totalAmount: parseFloat(exp.total_amount),
      currency: exp.currency,
      // Map settledAt from settled_at, fallback to updated_at only if settled_at is null and status is settled.
      settledAt: exp.settled_at
        ? (exp.settled_at as string).slice(0, 10)
        : exp.status === 'settled'
          ? (exp.updated_at as string).slice(0, 10)
          : null,
      participants: (exp.expense_participants ?? []).map((p: any) => ({
        userId: p.user_id,
        owedAmount: parseFloat(p.owed_amount),
        paidAmount: parseFloat(p.paid_amount),
      })),
      items: (exp.line_items ?? []).map((item: any) => ({
        name: item.name,
        totalPrice: parseFloat(item.total_price),
        // Map item category safely with a fallback to 'other'.
        category: (item.category as ItemCategory) ?? 'other',
        claimedByUserIds: (item.line_item_participants ?? []).map(
          (lip: any) => lip.user_id as string
        ),
      })),
    }));

    setState({ status: 'done', records });
  }, []);

  return { state, fetch };
}
