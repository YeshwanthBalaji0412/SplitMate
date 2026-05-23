import { useCallback, useEffect, useState } from 'react';
import type { GroupSnapshot } from '@splitmate/analytics';
import { computeSettlementStreak } from '@splitmate/analytics';
import { supabase } from '@/lib/supabase';

/**
 * Computes group-level financial metrics for a date window (default:
 * current month). Queries ALL expenses in the group — not just the
 * user's — so group totals are accurate even for bills the user didn't
 * participate in.
 */
export function useGroupStats(
  groupId: string | undefined,
  userId: string | undefined,
  window?: { from: string; to: string },
) {
  const [stats, setStats] = useState<GroupSnapshot | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!groupId || !userId) { setStats(null); setLoading(false); return; }
    setLoading(true);

    const from = window?.from ?? firstOfMonth();
    const to = window?.to ?? lastOfMonth();

    const { data: expRows } = await supabase
      .from('expenses')
      .select('id, date, bill_type, total_amount, status, settled_at, updated_at')
      .eq('group_id', groupId)
      .gte('date', from)
      .lte('date', to);

    if (!expRows || expRows.length === 0) {
      setStats({
        groupTotalSpend: 0, userShare: 0, avgSharePerMember: 0,
        memberCount: 0, topCategory: null, settlementStreak: 0,
      });
      setLoading(false);
      return;
    }

    const ids = expRows.map((e) => e.id as string);
    const { data: partRows } = await supabase
      .from('expense_participants')
      .select('expense_id, user_id, owed_amount')
      .in('expense_id', ids);

    let groupTotal = 0;
    let userShare = 0;
    const allUsers = new Set<string>();
    const catMap = new Map<string, number>();

    for (const exp of expRows) {
      const amt = parseFloat(exp.total_amount as string);
      groupTotal += amt;
      const cat = (exp.bill_type as string) ?? 'other';
      catMap.set(cat, (catMap.get(cat) ?? 0) + amt);
    }

    for (const p of partRows ?? []) {
      allUsers.add(p.user_id as string);
      if ((p.user_id as string) === userId) {
        userShare += parseFloat(p.owed_amount as string);
      }
    }

    const memberCount = allUsers.size || 1;
    const topCategory = [...catMap.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

    // Settlement streak from these records.
    const billRecords = expRows.map((e) => ({
      id: e.id as string,
      date: e.date as string,
      title: '',
      billType: (e.bill_type as string) ?? 'other',
      totalAmount: parseFloat(e.total_amount as string),
      currency: 'USD',
      status: e.status as string,
      settledAt: (e.settled_at as string | null)
        ?? (e.status === 'settled' ? (e.updated_at as string | null)?.slice(0, 10) ?? null : null),
      participants: [],
      items: [],
    }));
    const streak = computeSettlementStreak(billRecords);

    setStats({
      groupTotalSpend: Math.round(groupTotal * 100) / 100,
      userShare: Math.round(userShare * 100) / 100,
      avgSharePerMember: Math.round((groupTotal / memberCount) * 100) / 100,
      memberCount,
      topCategory,
      settlementStreak: streak,
    });
    setLoading(false);
  }, [groupId, userId, window?.from, window?.to]);

  useEffect(() => { load(); }, [load]);

  return { stats, loading, refresh: load };
}

function firstOfMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function lastOfMonth(): string {
  const d = new Date();
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0);
  return last.toISOString().slice(0, 10);
}
