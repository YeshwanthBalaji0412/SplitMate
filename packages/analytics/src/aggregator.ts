import type {
  BillRecord,
  TimeWindow,
  MonthlyReport,
  CategoryBreakdown,
  GroupSummary,
  BillCategory,
} from './types';
import { derivePersonality } from './personality';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function daysBetween(from: string, to: string): number {
  const msPerDay = 1000 * 60 * 60 * 24;
  return Math.round((new Date(to).getTime() - new Date(from).getTime()) / msPerDay);
}

function isInWindow(bill: BillRecord, window: TimeWindow): boolean {
  return bill.date >= window.from && bill.date <= window.to;
}

function getUserOwed(bill: BillRecord, userId: string): number {
  return bill.participants.find((p) => p.userId === userId)?.owedAmount ?? 0;
}

function isParticipant(bill: BillRecord, userId: string): boolean {
  return bill.participants.some((p) => p.userId === userId);
}

// ─── Category breakdown ───────────────────────────────────────────────────────

export function computeCategoryBreakdown(
  userId: string,
  bills: BillRecord[]
): CategoryBreakdown[] {
  const userBills = bills.filter((b) => isParticipant(b, userId));
  if (userBills.length === 0) return [];

  const totals = new Map<BillCategory, { spent: number; count: number }>();

  for (const bill of userBills) {
    const owed = getUserOwed(bill, userId);
    const existing = totals.get(bill.billType) ?? { spent: 0, count: 0 };
    totals.set(bill.billType, { spent: existing.spent + owed, count: existing.count + 1 });
  }

  const grandTotal = [...totals.values()].reduce((s, v) => s + v.spent, 0);

  return [...totals.entries()]
    .map(([billType, { spent, count }]) => ({
      billType,
      totalSpent: round2(spent),
      billCount: count,
      percentOfTotal: grandTotal > 0 ? round2((spent / grandTotal) * 100) : 0,
    }))
    .sort((a, b) => b.totalSpent - a.totalSpent);
}

// ─── Group summaries ──────────────────────────────────────────────────────────

export function computeGroupSummaries(
  userId: string,
  bills: BillRecord[]
): GroupSummary[] {
  const userBills = bills.filter((b) => isParticipant(b, userId));
  if (userBills.length === 0) return [];

  const groups = new Map<string, { totalSpent: number; yourShare: number; bills: BillRecord[] }>();

  for (const bill of userBills) {
    const owed = getUserOwed(bill, userId);
    const existing = groups.get(bill.groupId) ?? { totalSpent: 0, yourShare: 0, bills: [] };
    groups.set(bill.groupId, {
      totalSpent: existing.totalSpent + bill.totalAmount,
      yourShare: existing.yourShare + owed,
      bills: [...existing.bills, bill],
    });
  }

  return [...groups.entries()]
    .map(([groupId, { totalSpent, yourShare, bills: groupBills }]) => {
      // Most frequent bill type in this group
      const typeCounts = new Map<BillCategory, number>();
      for (const b of groupBills) typeCounts.set(b.billType, (typeCounts.get(b.billType) ?? 0) + 1);
      const mostFrequentCategory = [...typeCounts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;

      return {
        groupId,
        totalSpent: round2(totalSpent),
        yourShare: round2(yourShare),
        billCount: groupBills.length,
        mostFrequentCategory,
      };
    })
    .sort((a, b) => b.yourShare - a.yourShare);
}

// ─── Fairness delta ───────────────────────────────────────────────────────────

export function computeFairnessDelta(
  userId: string,
  bills: BillRecord[]
): { delta: number; label: 'even' | 'overpaying' | 'underpaying' } {
  const userBills = bills.filter((b) => isParticipant(b, userId));
  if (userBills.length === 0) return { delta: 0, label: 'even' };

  let totalDelta = 0;
  let totalBillValue = 0;

  for (const bill of userBills) {
    const participantCount = bill.participants.filter((p) => p.owedAmount > 0).length || 1;
    const equalShare = bill.totalAmount / participantCount;
    const actualOwed = getUserOwed(bill, userId);
    totalDelta += actualOwed - equalShare;
    totalBillValue += bill.totalAmount;
  }

  const meanDelta = round2(totalDelta / userBills.length);
  const meanBillValue = totalBillValue / userBills.length;

  // Within 5% of mean bill value = effectively even
  const threshold = meanBillValue * 0.05;
  const label: 'even' | 'overpaying' | 'underpaying' =
    Math.abs(meanDelta) < threshold ? 'even' : meanDelta > 0 ? 'overpaying' : 'underpaying';

  return { delta: meanDelta, label };
}

// ─── Settlement behaviour ─────────────────────────────────────────────────────

export function computeAvgDaysToSettle(
  userId: string,
  bills: BillRecord[]
): number | null {
  const settled = bills.filter(
    (b) => isParticipant(b, userId) && b.settledAt !== null
  );
  if (settled.length === 0) return null;

  const totalDays = settled.reduce((s, b) => s + daysBetween(b.date, b.settledAt!), 0);
  return round2(totalDays / settled.length);
}

export function computeSettlementStreak(bills: BillRecord[]): number {
  // Sort by bill creation date descending — most recently created bills first.
  // This answers: "how many of our recent bills were settled quickly?"
  const settled = bills
    .filter((b) => b.settledAt !== null)
    .sort((a, b) => b.date.localeCompare(a.date));

  if (settled.length === 0) return 0;

  let streak = 0;
  for (const bill of settled) {
    const days = daysBetween(bill.date, bill.settledAt!);
    if (days <= 2) {
      streak++;
    } else {
      break; // streak broken — stop counting
    }
  }
  return streak;
}

// ─── Main report ──────────────────────────────────────────────────────────────

export function computeMonthlyReport(
  userId: string,
  bills: BillRecord[],
  window: TimeWindow
): MonthlyReport {
  const windowBills = bills.filter((b) => isInWindow(b, window));
  const userWindowBills = windowBills.filter((b) => isParticipant(b, userId));

  const totalSpent = round2(
    userWindowBills.reduce((s, b) => s + getUserOwed(b, userId), 0)
  );

  const byCategory = computeCategoryBreakdown(userId, userWindowBills);
  const byGroup = computeGroupSummaries(userId, userWindowBills);
  const { delta: fairnessDelta, label: fairnessLabel } = computeFairnessDelta(userId, userWindowBills);
  const avgDaysToSettle = computeAvgDaysToSettle(userId, userWindowBills);
  const settlementStreakDays = computeSettlementStreak(userWindowBills);

  // Personality uses lifetime bills (not just window) for enough signal
  const spendingPersonality = derivePersonality(userId, bills);

  const groupIds = new Set(userWindowBills.map((b) => b.groupId));
  const currency = userWindowBills[0]?.currency ?? 'USD';

  return {
    userId,
    window,
    currency,
    totalSpent,
    totalBills: userWindowBills.length,
    groupsInvolved: groupIds.size,
    byCategory,
    byGroup,
    fairnessDelta,
    fairnessLabel,
    avgDaysToSettle,
    settlementStreakDays,
    spendingPersonality,
  };
}
