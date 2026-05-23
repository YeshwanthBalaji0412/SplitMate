import { describe, it, expect } from 'vitest';
import { computeMonthlyReport, computeSettlementStreak } from '../src/aggregator';
import { makeBill } from './helpers';

describe('computeMonthlyReport', () => {
  it('1. returns zeroed report for empty records', () => {
    const r = computeMonthlyReport([], 'u1');
    expect(r.totalSpent).toBe(0);
    expect(r.billCount).toBe(0);
    expect(r.categoryBreakdown).toHaveLength(0);
    expect(r.personality).toBeNull();
  });

  it('2. computes total spent from user owed amounts', () => {
    const bills = [
      makeBill({ id: '1', totalAmount: 80, participants: [{ userId: 'u1', owedAmount: 30, paidAmount: 0 }] }),
      makeBill({ id: '2', totalAmount: 60, participants: [{ userId: 'u1', owedAmount: 20, paidAmount: 0 }] }),
    ];
    const r = computeMonthlyReport(bills, 'u1');
    expect(r.totalSpent).toBe(50);
    expect(r.billCount).toBe(2);
  });

  it('3. breaks down by bill type', () => {
    const bills = [
      makeBill({ id: '1', billType: 'restaurant', participants: [{ userId: 'u1', owedAmount: 40, paidAmount: 0 }] }),
      makeBill({ id: '2', billType: 'grocery', participants: [{ userId: 'u1', owedAmount: 20, paidAmount: 0 }] }),
      makeBill({ id: '3', billType: 'restaurant', participants: [{ userId: 'u1', owedAmount: 10, paidAmount: 0 }] }),
    ];
    const r = computeMonthlyReport(bills, 'u1');
    expect(r.categoryBreakdown).toHaveLength(2);
    expect(r.categoryBreakdown[0]!.category).toBe('restaurant');
    expect(r.categoryBreakdown[0]!.amount).toBe(50);
    expect(r.topCategory).toBe('restaurant');
  });

  it('4. computes percentage in breakdown', () => {
    const bills = [
      makeBill({ id: '1', billType: 'restaurant', participants: [{ userId: 'u1', owedAmount: 75, paidAmount: 0 }] }),
      makeBill({ id: '2', billType: 'grocery', participants: [{ userId: 'u1', owedAmount: 25, paidAmount: 0 }] }),
    ];
    const r = computeMonthlyReport(bills, 'u1');
    expect(r.categoryBreakdown.find((c) => c.category === 'restaurant')!.percentage).toBe(75);
    expect(r.categoryBreakdown.find((c) => c.category === 'grocery')!.percentage).toBe(25);
  });

  it('5. computes avgDaysToSettle from settled bills', () => {
    const bills = [
      makeBill({ id: '1', date: '2026-05-01', settledAt: '2026-05-03', status: 'settled', participants: [{ userId: 'u1', owedAmount: 50, paidAmount: 0 }] }),
      makeBill({ id: '2', date: '2026-05-05', settledAt: '2026-05-06', status: 'settled', participants: [{ userId: 'u1', owedAmount: 50, paidAmount: 0 }] }),
    ];
    const r = computeMonthlyReport(bills, 'u1');
    expect(r.avgDaysToSettle).toBe(1.5); // (2 + 1) / 2
  });

  it('6. avgDaysToSettle null when no settled bills', () => {
    const bills = [makeBill({ id: '1', participants: [{ userId: 'u1', owedAmount: 50, paidAmount: 0 }] })];
    expect(computeMonthlyReport(bills, 'u1').avgDaysToSettle).toBeNull();
  });

  it('7. handles user not in any bill gracefully', () => {
    const bills = [makeBill({ id: '1', participants: [{ userId: 'u2', owedAmount: 50, paidAmount: 0 }] })];
    const r = computeMonthlyReport(bills, 'u1');
    expect(r.totalSpent).toBe(0);
  });
});

describe('computeSettlementStreak', () => {
  it('8. counts consecutive quick settlements from latest', () => {
    const bills = [
      makeBill({ id: '1', date: '2026-05-01', settledAt: '2026-05-01T12:00:00Z' }),
      makeBill({ id: '2', date: '2026-05-03', settledAt: '2026-05-03T06:00:00Z' }),
      makeBill({ id: '3', date: '2026-05-05', settledAt: '2026-05-05T23:00:00Z' }),
    ];
    expect(computeSettlementStreak(bills)).toBe(3);
  });

  it('9. breaks streak on slow settlement', () => {
    const bills = [
      makeBill({ id: '1', date: '2026-05-01', settledAt: '2026-05-10' }), // 9 days — slow
      makeBill({ id: '2', date: '2026-05-05', settledAt: '2026-05-05T12:00:00Z' }), // fast
    ];
    // Latest first: bill 2 (fast) then bill 1 (slow). Streak = 1.
    expect(computeSettlementStreak(bills)).toBe(1);
  });

  it('10. returns 0 for no settled bills', () => {
    const bills = [makeBill({ id: '1' }), makeBill({ id: '2' })];
    expect(computeSettlementStreak(bills)).toBe(0);
  });
});
