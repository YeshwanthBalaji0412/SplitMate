import { describe, expect, it } from 'vitest';
import type { ExpenseDebt } from '@splitmate/types';
import { computeGroupSettlement } from '../src/settlement';

const CURRENCY = 'USD';

function debt(expenseId: string, paidBy: string, breakdown: Array<[string, number]>): ExpenseDebt {
  return {
    expenseId,
    paidBy,
    breakdown: breakdown.map(([userId, totalOwed]) => ({ userId, totalOwed })),
  };
}

describe('computeGroupSettlement', () => {
  it('1. simple two-person settlement: B pays A once', () => {
    // A paid for a $50 bill; B owes $50.
    const { transfers } = computeGroupSettlement(
      [debt('exp-1', 'A', [['A', 0], ['B', 50]])],
      'optimized',
      CURRENCY,
    );
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({
      fromUserId: 'B',
      toUserId: 'A',
      amount: 50,
      currency: CURRENCY,
    });
    expect(transfers[0]!.expenseLinks).toEqual([{ expenseId: 'exp-1', amount: 50 }]);
  });

  it('2. three-person optimized settlement collapses through a hub', () => {
    // Two bills:
    //   exp-1 paid by A: B owes 30, C owes 0
    //   exp-2 paid by B: A owes 0, C owes 30
    // Net: A=+30 (creditor), B=0, C=-30 (debtor).
    // Optimized: a single transfer C -> A for $30. B is bypassed.
    const { transfers } = computeGroupSettlement(
      [
        debt('exp-1', 'A', [['A', 0], ['B', 30], ['C', 0]]),
        debt('exp-2', 'B', [['A', 0], ['B', 0], ['C', 30]]),
      ],
      'optimized',
      CURRENCY,
    );
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ fromUserId: 'C', toUserId: 'A', amount: 30 });
  });

  it('3. circular debt with zero net balances produces no transfers', () => {
    // A owed B 10, B owed C 10, C owed A 10. Net balance per user = 0.
    const { transfers } = computeGroupSettlement(
      [
        debt('exp-1', 'B', [['A', 10]]), // A owes B 10
        debt('exp-2', 'C', [['B', 10]]), // B owes C 10
        debt('exp-3', 'A', [['C', 10]]), // C owes A 10
      ],
      'optimized',
      CURRENCY,
    );
    expect(transfers).toHaveLength(0);
  });

  it('4. direct mode emits one transfer per (debtor, creditor, expense)', () => {
    // Two bills, both paid by A. B owes from each separately in direct mode.
    const { transfers } = computeGroupSettlement(
      [
        debt('exp-1', 'A', [['B', 20]]),
        debt('exp-2', 'A', [['B', 15]]),
      ],
      'direct',
      CURRENCY,
    );
    expect(transfers).toHaveLength(2);
    expect(transfers[0]!.amount + transfers[1]!.amount).toBe(35);
    // Each transfer pins exactly one expense link.
    for (const t of transfers) {
      expect(t.expenseLinks).toHaveLength(1);
    }
  });

  it('5. optimized mode reduces transfer count vs direct mode', () => {
    const debts = [
      debt('exp-1', 'A', [['B', 20]]),
      debt('exp-2', 'A', [['B', 15]]),
      debt('exp-3', 'A', [['B', 5]]),
    ];
    const direct = computeGroupSettlement(debts, 'direct', CURRENCY).transfers;
    const optimized = computeGroupSettlement(debts, 'optimized', CURRENCY).transfers;
    expect(direct).toHaveLength(3);
    expect(optimized).toHaveLength(1);
    expect(optimized[0]!.amount).toBe(40);
  });

  it('6. creditor/debtor net balances drive the right direction of money flow', () => {
    // Two creditors (A=+50, B=+20), one debtor (C=-70).
    const { transfers } = computeGroupSettlement(
      [
        debt('exp-1', 'A', [['C', 50]]),
        debt('exp-2', 'B', [['C', 20]]),
      ],
      'optimized',
      CURRENCY,
    );
    // C must pay 70 total; either 2 transfers or matched separately.
    const totalFromC = transfers
      .filter((t) => t.fromUserId === 'C')
      .reduce((s, t) => s + t.amount, 0);
    expect(totalFromC).toBe(70);
    for (const t of transfers) {
      expect(['A', 'B']).toContain(t.toUserId);
      expect(t.fromUserId).toBe('C');
    }
  });

  it('7. each transfer carries expenseLinks that sum to the transfer amount', () => {
    const debts = [
      debt('exp-1', 'A', [['B', 25]]),
      debt('exp-2', 'A', [['B', 25]]),
    ];
    const { transfers } = computeGroupSettlement(debts, 'optimized', CURRENCY);
    for (const t of transfers) {
      const linkSum = t.expenseLinks.reduce((s, l) => s + l.amount, 0);
      expect(linkSum).toBeCloseTo(t.amount, 2);
      // optimized mode merges A->B by both bills into one transfer
      expect(t.expenseLinks.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('8. users with zero net balance are excluded from transfers', () => {
    // A paid 50 for B, then B paid 50 for A. Net for both = 0.
    const { transfers } = computeGroupSettlement(
      [
        debt('exp-1', 'A', [['B', 50]]),
        debt('exp-2', 'B', [['A', 50]]),
      ],
      'optimized',
      CURRENCY,
    );
    expect(transfers).toHaveLength(0);
  });

  it('9. settlement amounts are cent-precise (no float drift)', () => {
    const { transfers } = computeGroupSettlement(
      [debt('exp-1', 'A', [['B', 33.33], ['C', 33.34]])],
      'optimized',
      CURRENCY,
    );
    for (const t of transfers) {
      // amount must have at most 2 decimal places.
      expect(Math.round(t.amount * 100) / 100).toBe(t.amount);
    }
    const total = transfers.reduce((s, t) => s + t.amount, 0);
    expect(Math.round(total * 100) / 100).toBe(66.67);
  });

  it('10. multiple expenses across same debtor/creditor pair merge into one optimized transfer', () => {
    // B owes A across three bills. Optimized should emit a single transfer
    // whose expenseLinks contain all three sources.
    const { transfers } = computeGroupSettlement(
      [
        debt('exp-1', 'A', [['B', 10]]),
        debt('exp-2', 'A', [['B', 15]]),
        debt('exp-3', 'A', [['B', 25]]),
      ],
      'optimized',
      CURRENCY,
    );
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toMatchObject({ fromUserId: 'B', toUserId: 'A', amount: 50 });
    const linkExpenseIds = transfers[0]!.expenseLinks.map((l) => l.expenseId).sort();
    expect(linkExpenseIds).toEqual(['exp-1', 'exp-2', 'exp-3']);
    const linkSum = transfers[0]!.expenseLinks.reduce((s, l) => s + l.amount, 0);
    expect(linkSum).toBe(50);
  });

  it('11. empty debts input returns no transfers', () => {
    const { transfers } = computeGroupSettlement([], 'optimized', CURRENCY);
    expect(transfers).toEqual([]);
  });

  it('12. direct mode never merges across (debtor, creditor) pairs', () => {
    // Direct: one transfer per atom, even if same pair.
    const { transfers } = computeGroupSettlement(
      [
        debt('exp-1', 'A', [['B', 10]]),
        debt('exp-2', 'A', [['B', 10]]),
        debt('exp-3', 'A', [['B', 10]]),
      ],
      'direct',
      CURRENCY,
    );
    expect(transfers).toHaveLength(3);
    for (const t of transfers) {
      expect(t.amount).toBe(10);
      expect(t.expenseLinks).toHaveLength(1);
    }
  });
});
