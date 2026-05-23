import type { BillRecord, MonthlyReport } from './types';
import { derivePersonality, type SpendingPersonality } from './personality';

/**
 * Compute a monthly report from a window of BillRecords.
 *
 * Pure function: takes plain arrays, returns a plain object.
 * No database calls — the caller fetches the records, we crunch them.
 */
export function computeMonthlyReport(
  records: BillRecord[],
  userId: string,
): MonthlyReport {
  if (records.length === 0) {
    return {
      totalSpent: 0,
      billCount: 0,
      categoryBreakdown: [],
      topCategory: null,
      avgDaysToSettle: null,
      settlementStreak: computeSettlementStreak(records),
      personality: null,
    };
  }

  // Total the user's share across all records.
  let totalSpent = 0;
  const categoryMap = new Map<string, number>();

  for (const rec of records) {
    const myShare = rec.participants.find((p) => p.userId === userId);
    const amount = myShare?.owedAmount ?? 0;
    totalSpent += amount;

    const cat = rec.billType ?? 'other';
    categoryMap.set(cat, (categoryMap.get(cat) ?? 0) + amount);
  }
  totalSpent = Math.round(totalSpent * 100) / 100;

  // Category breakdown sorted by amount descending.
  const categoryBreakdown = Array.from(categoryMap.entries())
    .map(([category, amount]) => ({
      category,
      amount: Math.round(amount * 100) / 100,
      percentage: totalSpent > 0 ? Math.round((amount / totalSpent) * 100) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  const topCategory = categoryBreakdown[0]?.category ?? null;

  // Average days to settle.
  const daysToSettle: number[] = [];
  for (const rec of records) {
    if (rec.settledAt && rec.date) {
      const created = new Date(rec.date).getTime();
      const settled = new Date(rec.settledAt).getTime();
      if (settled >= created) {
        daysToSettle.push(Math.round((settled - created) / (1000 * 60 * 60 * 24)));
      }
    }
  }
  const avgDaysToSettle =
    daysToSettle.length > 0
      ? Math.round((daysToSettle.reduce((s, d) => s + d, 0) / daysToSettle.length) * 10) / 10
      : null;

  // Personality (requires 5+ lifetime bills).
  const personality = derivePersonality(records, userId);

  return {
    totalSpent,
    billCount: records.length,
    categoryBreakdown,
    topCategory,
    avgDaysToSettle,
    settlementStreak: computeSettlementStreak(records),
    personality,
  };
}

/**
 * Count consecutive most-recent settled bills where settled_at was
 * within 48 hours of the bill date. The streak breaks on the first
 * unsettled or slow-settled bill going backward from the latest.
 */
export function computeSettlementStreak(records: BillRecord[]): number {
  const sorted = [...records]
    .filter((r) => r.settledAt && r.date)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  let streak = 0;
  for (const rec of sorted) {
    const created = new Date(rec.date).getTime();
    const settled = new Date(rec.settledAt!).getTime();
    const hours = (settled - created) / (1000 * 60 * 60);
    if (hours <= 48) {
      streak++;
    } else {
      break;
    }
  }
  return streak;
}
