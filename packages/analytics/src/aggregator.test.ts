import { describe, it, expect } from 'vitest';
import {
  computeCategoryBreakdown,
  computeGroupSummaries,
  computeFairnessDelta,
  computeAvgDaysToSettle,
  computeSettlementStreak,
  computeMonthlyReport,
} from './aggregator';
import type { BillRecord } from './types';

// ─── Test data helpers ────────────────────────────────────────────────────────

function bill(overrides: Partial<BillRecord> & { id: string }): BillRecord {
  const totalAmount = overrides.totalAmount ?? 100;
  return {
    groupId: 'group-1',
    date: '2026-05-01',
    billType: 'restaurant',
    totalAmount,
    currency: 'USD',
    settledAt: null,
    // Default: split equally between alice and bob, scaled to totalAmount
    participants: [
      { userId: 'alice', owedAmount: totalAmount / 2, paidAmount: totalAmount },
      { userId: 'bob', owedAmount: totalAmount / 2, paidAmount: 0 },
    ],
    items: [],
    ...overrides,
  };
}

const ALICE = 'alice';
const BOB = 'bob';

// ─── computeCategoryBreakdown ─────────────────────────────────────────────────

describe('computeCategoryBreakdown', () => {
  it('returns empty array for no bills', () => {
    expect(computeCategoryBreakdown(ALICE, [])).toEqual([]);
  });

  it('returns empty array when user has no bills', () => {
    const bills = [bill({ id: '1', participants: [{ userId: BOB, owedAmount: 100, paidAmount: 100 }] })];
    expect(computeCategoryBreakdown(ALICE, bills)).toEqual([]);
  });

  it('returns single category for single bill', () => {
    const bills = [bill({ id: '1', billType: 'restaurant', totalAmount: 100 })];
    const result = computeCategoryBreakdown(ALICE, bills);
    expect(result).toHaveLength(1);
    expect(result[0].billType).toBe('restaurant');
    expect(result[0].totalSpent).toBe(50);
    expect(result[0].billCount).toBe(1);
    expect(result[0].percentOfTotal).toBe(100);
  });

  it('aggregates multiple bills of same category', () => {
    const bills = [
      bill({ id: '1', billType: 'restaurant', totalAmount: 100 }),
      bill({ id: '2', billType: 'restaurant', totalAmount: 200 }),
    ];
    const result = computeCategoryBreakdown(ALICE, bills);
    expect(result).toHaveLength(1);
    expect(result[0].totalSpent).toBe(150); // 50 + 100
    expect(result[0].billCount).toBe(2);
  });

  it('separates multiple categories', () => {
    const bills = [
      bill({ id: '1', billType: 'restaurant', totalAmount: 100 }),
      bill({ id: '2', billType: 'delivery', totalAmount: 60 }),
    ];
    const result = computeCategoryBreakdown(ALICE, bills);
    expect(result).toHaveLength(2);
    expect(result[0].billType).toBe('restaurant'); // higher spend first
    expect(result[0].totalSpent).toBe(50);
    expect(result[1].billType).toBe('delivery');
    expect(result[1].totalSpent).toBe(30);
  });

  it('percentOfTotal sums to 100', () => {
    const bills = [
      bill({ id: '1', billType: 'restaurant', totalAmount: 100 }),
      bill({ id: '2', billType: 'delivery', totalAmount: 100 }),
      bill({ id: '3', billType: 'grocery', totalAmount: 100 }),
    ];
    const result = computeCategoryBreakdown(ALICE, bills);
    const total = result.reduce((s, r) => s + r.percentOfTotal, 0);
    expect(Math.round(total)).toBe(100);
  });

  it('only counts bills where user is a participant', () => {
    const bills = [
      bill({ id: '1', billType: 'restaurant' }),
      bill({ id: '2', billType: 'delivery', participants: [{ userId: BOB, owedAmount: 80, paidAmount: 80 }] }),
    ];
    const result = computeCategoryBreakdown(ALICE, bills);
    expect(result).toHaveLength(1);
    expect(result[0].billType).toBe('restaurant');
  });
});

// ─── computeGroupSummaries ────────────────────────────────────────────────────

describe('computeGroupSummaries', () => {
  it('returns empty for no bills', () => {
    expect(computeGroupSummaries(ALICE, [])).toEqual([]);
  });

  it('returns single group summary', () => {
    const bills = [bill({ id: '1', groupId: 'g1', totalAmount: 100 })];
    const result = computeGroupSummaries(ALICE, bills);
    expect(result).toHaveLength(1);
    expect(result[0].groupId).toBe('g1');
    expect(result[0].totalSpent).toBe(100);
    expect(result[0].yourShare).toBe(50);
    expect(result[0].billCount).toBe(1);
    expect(result[0].mostFrequentCategory).toBe('restaurant');
  });

  it('separates multiple groups', () => {
    const bills = [
      bill({ id: '1', groupId: 'g1', totalAmount: 100 }),
      bill({ id: '2', groupId: 'g2', totalAmount: 60 }),
    ];
    const result = computeGroupSummaries(ALICE, bills);
    expect(result).toHaveLength(2);
    expect(result[0].groupId).toBe('g1'); // higher share first
  });

  it('picks mostFrequentCategory correctly', () => {
    const bills = [
      bill({ id: '1', groupId: 'g1', billType: 'delivery' }),
      bill({ id: '2', groupId: 'g1', billType: 'delivery' }),
      bill({ id: '3', groupId: 'g1', billType: 'restaurant' }),
    ];
    const result = computeGroupSummaries(ALICE, bills);
    expect(result[0].mostFrequentCategory).toBe('delivery');
  });
});

// ─── computeFairnessDelta ─────────────────────────────────────────────────────

describe('computeFairnessDelta', () => {
  it('returns even for no bills', () => {
    const result = computeFairnessDelta(ALICE, []);
    expect(result.label).toBe('even');
    expect(result.delta).toBe(0);
  });

  it('returns even when split exactly equally', () => {
    const bills = [bill({ id: '1', totalAmount: 100 })]; // alice owes 50, equal share = 50
    const result = computeFairnessDelta(ALICE, bills);
    expect(result.label).toBe('even');
    expect(result.delta).toBe(0);
  });

  it('returns overpaying when user consistently pays more', () => {
    const bills = [
      bill({
        id: '1',
        totalAmount: 100,
        participants: [
          { userId: ALICE, owedAmount: 80, paidAmount: 100 }, // equal share = 50
          { userId: BOB, owedAmount: 20, paidAmount: 0 },
        ],
      }),
    ];
    const result = computeFairnessDelta(ALICE, bills);
    expect(result.label).toBe('overpaying');
    expect(result.delta).toBeGreaterThan(0);
  });

  it('returns underpaying when user consistently pays less', () => {
    const bills = [
      bill({
        id: '1',
        totalAmount: 100,
        participants: [
          { userId: ALICE, owedAmount: 20, paidAmount: 100 },
          { userId: BOB, owedAmount: 80, paidAmount: 0 },
        ],
      }),
    ];
    const result = computeFairnessDelta(ALICE, bills);
    expect(result.label).toBe('underpaying');
    expect(result.delta).toBeLessThan(0);
  });
});

// ─── computeAvgDaysToSettle ───────────────────────────────────────────────────

describe('computeAvgDaysToSettle', () => {
  it('returns null for no settled bills', () => {
    const bills = [bill({ id: '1', settledAt: null })];
    expect(computeAvgDaysToSettle(ALICE, bills)).toBeNull();
  });

  it('returns null for empty bills', () => {
    expect(computeAvgDaysToSettle(ALICE, [])).toBeNull();
  });

  it('returns 0 for same-day settlement', () => {
    const bills = [bill({ id: '1', date: '2026-05-01', settledAt: '2026-05-01' })];
    expect(computeAvgDaysToSettle(ALICE, bills)).toBe(0);
  });

  it('returns correct days for single bill', () => {
    const bills = [bill({ id: '1', date: '2026-05-01', settledAt: '2026-05-03' })];
    expect(computeAvgDaysToSettle(ALICE, bills)).toBe(2);
  });

  it('returns average across multiple settled bills', () => {
    const bills = [
      bill({ id: '1', date: '2026-05-01', settledAt: '2026-05-03' }), // 2 days
      bill({ id: '2', date: '2026-05-05', settledAt: '2026-05-09' }), // 4 days
    ];
    expect(computeAvgDaysToSettle(ALICE, bills)).toBe(3); // (2+4)/2
  });

  it('ignores unsettled bills', () => {
    const bills = [
      bill({ id: '1', date: '2026-05-01', settledAt: '2026-05-03' }), // 2 days
      bill({ id: '2', settledAt: null }),                              // ignored
    ];
    expect(computeAvgDaysToSettle(ALICE, bills)).toBe(2);
  });
});

// ─── computeSettlementStreak ──────────────────────────────────────────────────

describe('computeSettlementStreak', () => {
  it('returns 0 for no bills', () => {
    expect(computeSettlementStreak([])).toBe(0);
  });

  it('returns 0 for no settled bills', () => {
    expect(computeSettlementStreak([bill({ id: '1', settledAt: null })])).toBe(0);
  });

  it('counts bills settled within 48hrs', () => {
    const bills = [
      bill({ id: '1', date: '2026-05-01', settledAt: '2026-05-02' }), // 1 day
      bill({ id: '2', date: '2026-05-03', settledAt: '2026-05-04' }), // 1 day
    ];
    expect(computeSettlementStreak(bills)).toBe(2);
  });

  it('breaks streak at first bill over 48hrs', () => {
    const bills = [
      bill({ id: '3', date: '2026-05-07', settledAt: '2026-05-08' }), // 1 day — most recent
      bill({ id: '2', date: '2026-05-05', settledAt: '2026-05-10' }), // 5 days — breaks streak
      bill({ id: '1', date: '2026-05-01', settledAt: '2026-05-02' }), // 1 day — before break
    ];
    expect(computeSettlementStreak(bills)).toBe(1); // only most recent counts
  });

  it('exact 2 days (48hrs) counts as within streak', () => {
    const bills = [
      bill({ id: '1', date: '2026-05-01', settledAt: '2026-05-03' }), // exactly 2 days
    ];
    expect(computeSettlementStreak(bills)).toBe(1);
  });
});

// ─── computeMonthlyReport ─────────────────────────────────────────────────────

describe('computeMonthlyReport', () => {
  it('returns zero report for no bills in window', () => {
    const report = computeMonthlyReport(ALICE, [], {
      from: '2026-05-01',
      to: '2026-05-31',
    });
    expect(report.totalSpent).toBe(0);
    expect(report.totalBills).toBe(0);
    expect(report.groupsInvolved).toBe(0);
    expect(report.byCategory).toEqual([]);
    expect(report.byGroup).toEqual([]);
    expect(report.spendingPersonality).toBeNull();
  });

  it('filters bills to window correctly', () => {
    const bills = [
      bill({ id: '1', date: '2026-05-15', totalAmount: 100 }), // in window
      bill({ id: '2', date: '2026-04-10', totalAmount: 200 }), // out of window
    ];
    const report = computeMonthlyReport(ALICE, bills, { from: '2026-05-01', to: '2026-05-31' });
    expect(report.totalBills).toBe(1);
    expect(report.totalSpent).toBe(50);
  });

  it('uses lifetime bills for personality (not just window)', () => {
    // 5 bills lifetime but only 1 in window
    const lifetimeBills = Array.from({ length: 5 }, (_, i) =>
      bill({ id: `${i}`, date: `2026-0${i + 1}-01` })
    );
    const report = computeMonthlyReport(ALICE, lifetimeBills, {
      from: '2026-05-01',
      to: '2026-05-31',
    });
    // Personality uses all 5 lifetime bills — should not be null
    expect(report.spendingPersonality).not.toBeNull();
  });

  it('counts unique groups', () => {
    const bills = [
      bill({ id: '1', groupId: 'g1', date: '2026-05-01' }),
      bill({ id: '2', groupId: 'g2', date: '2026-05-05' }),
      bill({ id: '3', groupId: 'g1', date: '2026-05-10' }),
    ];
    const report = computeMonthlyReport(ALICE, bills, { from: '2026-05-01', to: '2026-05-31' });
    expect(report.groupsInvolved).toBe(2);
  });

  it('uses currency from first bill', () => {
    const bills = [bill({ id: '1', currency: 'INR', date: '2026-05-01' })];
    const report = computeMonthlyReport(ALICE, bills, { from: '2026-05-01', to: '2026-05-31' });
    expect(report.currency).toBe('INR');
  });

  it('defaults currency to USD when no bills', () => {
    const report = computeMonthlyReport(ALICE, [], { from: '2026-05-01', to: '2026-05-31' });
    expect(report.currency).toBe('USD');
  });
});
