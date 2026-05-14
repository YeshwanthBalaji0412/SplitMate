import { describe, it, expect } from 'vitest';
import {
  minimizeSettlements,
  computeGroupNetBalances,
  computeGroupSettlement,
} from './settlement';
import type { ExpenseDebt } from './settlement';

// ─── minimizeSettlements ──────────────────────────────────────────────────────

describe('minimizeSettlements', () => {
  it('produces no transfers when all balances are zero', () => {
    const balances = new Map([['A', 0], ['B', 0]]);
    expect(minimizeSettlements(balances)).toEqual([]);
  });

  it('produces one transfer for a simple 2-person debt', () => {
    const balances = new Map([['A', 50], ['B', -50]]);
    const transfers = minimizeSettlements(balances);
    expect(transfers).toHaveLength(1);
    expect(transfers[0]).toEqual({ fromUserId: 'B', toUserId: 'A', amount: 50 });
  });

  it('minimizes 3-person circular debt to 2 transfers', () => {
    // A is owed $30, B is owed $10, C owes $40
    const balances = new Map([['A', 30], ['B', 10], ['C', -40]]);
    const transfers = minimizeSettlements(balances);
    expect(transfers).toHaveLength(2);
    const totalTransferred = transfers.reduce((s, t) => s + t.amount, 0);
    expect(totalTransferred).toBe(40);
  });

  it('handles 4-person scenario', () => {
    // A: +60, B: +20, C: -50, D: -30
    const balances = new Map([['A', 60], ['B', 20], ['C', -50], ['D', -30]]);
    const transfers = minimizeSettlements(balances);
    // Should need at most 3 transfers (N-1)
    expect(transfers.length).toBeLessThanOrEqual(3);
    // Verify conservation: total going out = total coming in
    const totalOut = transfers.reduce((s, t) => s + t.amount, 0);
    expect(totalOut).toBe(80);
  });
});

// ─── computeGroupNetBalances ──────────────────────────────────────────────────

describe('computeGroupNetBalances', () => {
  it('computes net balances from a single expense', () => {
    const net = computeGroupNetBalances([
      { paidBy: 'A', breakdown: [{ userId: 'A', totalOwed: 30 }, { userId: 'B', totalOwed: 30 }, { userId: 'C', totalOwed: 30 }] },
    ]);
    expect(net.get('A')).toBe(60); // owed by B + C
    expect(net.get('B')).toBe(-30);
    expect(net.get('C')).toBe(-30);
  });

  it('nets across multiple expenses', () => {
    const net = computeGroupNetBalances([
      { paidBy: 'A', breakdown: [{ userId: 'A', totalOwed: 50 }, { userId: 'B', totalOwed: 50 }] },
      { paidBy: 'B', breakdown: [{ userId: 'A', totalOwed: 30 }, { userId: 'B', totalOwed: 30 }] },
    ]);
    // Expense 1: B owes A $50. Expense 2: A owes B $30. Net: B owes A $20.
    expect(net.get('A')).toBe(20); // +50 - 30
    expect(net.get('B')).toBe(-20); // -50 + 30
  });
});

// ─── computeGroupSettlement — direct mode ─────────────────────────────────────

describe('computeGroupSettlement — direct mode', () => {
  it('creates one transfer per debtor per expense', () => {
    const expenses: ExpenseDebt[] = [
      { expenseId: 'e1', paidBy: 'A', breakdown: [{ userId: 'A', totalOwed: 30 }, { userId: 'B', totalOwed: 30 }, { userId: 'C', totalOwed: 40 }] },
      { expenseId: 'e2', paidBy: 'B', breakdown: [{ userId: 'A', totalOwed: 25 }, { userId: 'B', totalOwed: 25 }] },
    ];

    const result = computeGroupSettlement(expenses, 'direct');

    expect(result.mode).toBe('direct');
    // e1: B→A $30, C→A $40. e2: A→B $25. Total: 3 transfers.
    expect(result.transfers).toHaveLength(3);

    // Every transfer has exactly one expense link
    for (const t of result.transfers) {
      expect(t.expenseLinks).toHaveLength(1);
      expect(t.expenseLinks[0].amount).toBe(t.amount);
    }
  });

  it('skips transfers where owed amount is zero', () => {
    const expenses: ExpenseDebt[] = [
      { expenseId: 'e1', paidBy: 'A', breakdown: [{ userId: 'A', totalOwed: 100 }, { userId: 'B', totalOwed: 0 }] },
    ];

    const result = computeGroupSettlement(expenses, 'direct');
    expect(result.transfers).toHaveLength(0);
  });
});

// ─── computeGroupSettlement — optimized mode ──────────────────────────────────

describe('computeGroupSettlement — optimized mode', () => {
  it('minimizes transfers across expenses', () => {
    const expenses: ExpenseDebt[] = [
      { expenseId: 'e1', paidBy: 'A', breakdown: [{ userId: 'A', totalOwed: 30 }, { userId: 'B', totalOwed: 30 }, { userId: 'C', totalOwed: 40 }] },
      { expenseId: 'e2', paidBy: 'B', breakdown: [{ userId: 'A', totalOwed: 25 }, { userId: 'B', totalOwed: 25 }] },
    ];

    const result = computeGroupSettlement(expenses, 'optimized');

    expect(result.mode).toBe('optimized');
    // Direct would be 3 transfers. Optimized should be fewer or equal.
    expect(result.transfers.length).toBeLessThanOrEqual(3);
  });

  it('includes expense links on each transfer', () => {
    const expenses: ExpenseDebt[] = [
      { expenseId: 'e1', paidBy: 'A', breakdown: [{ userId: 'A', totalOwed: 50 }, { userId: 'B', totalOwed: 50 }] },
    ];

    const result = computeGroupSettlement(expenses, 'optimized');

    expect(result.transfers).toHaveLength(1);
    expect(result.transfers[0].expenseLinks).toHaveLength(1);
    expect(result.transfers[0].expenseLinks[0].expenseId).toBe('e1');
    expect(result.transfers[0].expenseLinks[0].amount).toBe(50);
  });

  it('attributes multi-expense transfers proportionally', () => {
    const expenses: ExpenseDebt[] = [
      { expenseId: 'e1', paidBy: 'A', breakdown: [{ userId: 'A', totalOwed: 40 }, { userId: 'B', totalOwed: 60 }] },
      { expenseId: 'e2', paidBy: 'A', breakdown: [{ userId: 'A', totalOwed: 10 }, { userId: 'B', totalOwed: 40 }] },
    ];

    const result = computeGroupSettlement(expenses, 'optimized');

    // B owes A: $60 from e1 + $40 from e2 = $100 total
    expect(result.transfers).toHaveLength(1);
    expect(result.transfers[0].amount).toBe(100);
    expect(result.transfers[0].expenseLinks).toHaveLength(2);

    const e1Link = result.transfers[0].expenseLinks.find((l) => l.expenseId === 'e1')!;
    const e2Link = result.transfers[0].expenseLinks.find((l) => l.expenseId === 'e2')!;
    // Proportional: 60/100 * 100 = 60, 40/100 * 100 = 40
    expect(e1Link.amount).toBe(60);
    expect(e2Link.amount).toBe(40);
  });
});
