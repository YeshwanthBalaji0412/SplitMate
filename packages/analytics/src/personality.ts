import type { BillRecord } from './types';

/**
 * Spending personality types. Deterministic: same bills always produce
 * the same label. Requires 5+ bills to derive; returns null otherwise.
 *
 *   Splurger    – consistently above group average share
 *   Even-Steven – very close to group average (within 10%)
 *   Optimizer   – consistently below group average
 *   Settler     – settles quickly (avg < 24 hours)
 */
export type SpendingPersonality = 'Splurger' | 'Even-Steven' | 'Optimizer' | 'Settler';

const MIN_BILLS_FOR_PERSONALITY = 5;

export function derivePersonality(
  records: BillRecord[],
  userId: string,
): SpendingPersonality | null {
  if (records.length < MIN_BILLS_FOR_PERSONALITY) return null;

  let userTotal = 0;
  let groupTotal = 0;
  let participantSum = 0;
  let settledCount = 0;
  let totalHoursToSettle = 0;

  for (const rec of records) {
    const myShare = rec.participants.find((p) => p.userId === userId);
    const userAmt = myShare?.owedAmount ?? 0;
    userTotal += userAmt;

    const billTotal = rec.participants.reduce((s, p) => s + p.owedAmount, 0);
    groupTotal += billTotal;
    participantSum += rec.participants.length;

    if (rec.settledAt && rec.date) {
      const created = new Date(rec.date).getTime();
      const settled = new Date(rec.settledAt).getTime();
      if (settled >= created) {
        settledCount++;
        totalHoursToSettle += (settled - created) / (1000 * 60 * 60);
      }
    }
  }

  // Average share: if everyone paid equally, each would pay groupTotal / participantSum.
  const avgSharePerBill = participantSum > 0 ? groupTotal / participantSum : 0;
  const avgUserPerBill = userTotal / records.length;
  const ratio = avgSharePerBill > 0 ? avgUserPerBill / avgSharePerBill : 1;

  // Settler: settles most bills within 24 hours
  if (settledCount >= records.length * 0.6) {
    const avgHours = totalHoursToSettle / settledCount;
    if (avgHours < 24) return 'Settler';
  }

  // Spending pattern
  if (ratio > 1.1) return 'Splurger';
  if (ratio < 0.9) return 'Optimizer';
  return 'Even-Steven';
}
