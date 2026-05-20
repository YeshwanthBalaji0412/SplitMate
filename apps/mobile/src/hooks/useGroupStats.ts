import { useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import type { BillRecord, BillCategory, ItemCategory } from '@split-smart/analytics';
import { computeSettlementStreak } from '@split-smart/analytics';
import type { BillWindow } from './useBillRecords';

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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface GroupSnapshot {
  groupName: string;
  currency: string;
  totalGroupSpend: number;
  yourShare: number;
  avgSharePerPerson: number;
  participantCount: number;
  billCount: number;
  settlementStreak: number;
  topCategory: BillCategory | null;
  topCategoryAmount: number;
}

type GroupStatsState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'done'; snapshot: GroupSnapshot | null }
  | { status: 'error'; message: string };

export function useGroupStats() {
  const [state, setState] = useState<GroupStatsState>({ status: 'idle' });

  const fetch = useCallback(async (groupId: string, userId: string, window: BillWindow) => {
    setState({ status: 'loading' });

    const [{ data: group, error: gErr }, { data: expenses, error: eErr }] = await Promise.all([
      supabase.from('groups').select('name, currency').eq('id', groupId).single(),
      supabase
        .from('expenses')
        .select(`
          id, group_id, date, bill_type, total_amount, currency, status, updated_at,
          expense_participants ( user_id, owed_amount, paid_amount ),
          line_items (
            id, name, total_price,
            line_item_participants ( user_id )
          )
        `)
        .eq('group_id', groupId)
        .gte('date', window.from)
        .lte('date', window.to)
        .neq('status', 'draft'),
    ]);

    if (gErr || !group) {
      setState({ status: 'error', message: gErr?.message ?? 'Group not found' });
      return;
    }
    if (eErr) {
      setState({ status: 'error', message: eErr.message });
      return;
    }

    if (!expenses || expenses.length === 0) {
      setState({ status: 'done', snapshot: null });
      return;
    }

    const records: BillRecord[] = (expenses as any[]).map((exp) => ({
      id: exp.id,
      groupId: exp.group_id,
      date: exp.date,
      billType: toBillCategory(exp.bill_type),
      totalAmount: parseFloat(exp.total_amount),
      currency: exp.currency,
      settledAt: exp.status === 'settled' ? (exp.updated_at as string).slice(0, 10) : null,
      participants: (exp.expense_participants ?? []).map((p: any) => ({
        userId: p.user_id,
        owedAmount: parseFloat(p.owed_amount),
        paidAmount: parseFloat(p.paid_amount),
      })),
      items: (exp.line_items ?? []).map((item: any) => ({
        name: item.name,
        totalPrice: parseFloat(item.total_price),
        category: 'other' as ItemCategory,
        claimedByUserIds: (item.line_item_participants ?? []).map((lip: any) => lip.user_id as string),
      })),
    }));

    const totalGroupSpend = records.reduce((s, b) => s + b.totalAmount, 0);

    const yourShare = records.reduce((s, b) => {
      const p = b.participants.find((p) => p.userId === userId);
      return s + (p?.owedAmount ?? 0);
    }, 0);

    const uniqueParticipants = new Set<string>();
    for (const b of records) {
      for (const p of b.participants) uniqueParticipants.add(p.userId);
    }
    const participantCount = uniqueParticipants.size || 1;
    const avgSharePerPerson = totalGroupSpend / participantCount;

    const settlementStreak = computeSettlementStreak(records);

    const categoryTotals = new Map<BillCategory, number>();
    for (const b of records) {
      categoryTotals.set(b.billType, (categoryTotals.get(b.billType) ?? 0) + b.totalAmount);
    }
    const topEntry = [...categoryTotals.entries()].sort((a, b) => b[1] - a[1])[0];

    setState({
      status: 'done',
      snapshot: {
        groupName: group.name,
        currency: group.currency,
        totalGroupSpend: round2(totalGroupSpend),
        yourShare: round2(yourShare),
        avgSharePerPerson: round2(avgSharePerPerson),
        participantCount,
        billCount: records.length,
        settlementStreak,
        topCategory: topEntry?.[0] ?? null,
        topCategoryAmount: round2(topEntry?.[1] ?? 0),
      },
    });
  }, []);

  return { state, fetch };
}
