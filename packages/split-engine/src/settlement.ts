/**
 * Settlement minimization — reduces N*(N-1)/2 potential transfers to at most N-1.
 *
 * Algorithm: net-balance approach.
 * 1. Compute each person's net balance (positive = is owed money, negative = owes money).
 * 2. Greedily match the biggest creditor with the biggest debtor until all balances are zero.
 *
 * This produces the minimum number of transactions needed to settle the group.
 */

import type { SettlementMode, SettlementExpenseLink } from '@split-smart/types';

export interface Transfer {
  fromUserId: string;
  toUserId: string;
  amount: number;
}

/** A transfer with traceability to source expenses. */
export interface TraceableTransfer extends Transfer {
  expenseLinks: Array<{
    expenseId: string;
    amount: number; // how much of this transfer came from this expense
  }>;
}

/** Per-expense debt: who owes whom and how much, from a single expense. */
export interface ExpenseDebt {
  expenseId: string;
  paidBy: string;
  breakdown: Array<{ userId: string; totalOwed: number }>;
}

export interface GroupSettlementResult {
  mode: SettlementMode;
  transfers: TraceableTransfer[];
  totalAmount: number;
}

/**
 * Given a map of userId → net balance (positive = owed to them, negative = they owe),
 * returns the minimum set of transfers to settle all debts.
 */
export function minimizeSettlements(netBalances: Map<string, number>): Transfer[] {
  const EPSILON = 0.001; // treat amounts < $0.001 as settled
  const transfers: Transfer[] = [];

  // Clone balances so we don't mutate the input
  const balances = new Map(netBalances);

  // Separate into creditors (positive) and debtors (negative)
  const creditors: Array<{ uid: string; amount: number }> = [];
  const debtors: Array<{ uid: string; amount: number }> = [];

  for (const [uid, amount] of balances) {
    if (amount > EPSILON) creditors.push({ uid, amount });
    else if (amount < -EPSILON) debtors.push({ uid, amount: -amount }); // store as positive
  }

  // Sort descending by amount for greedy matching
  creditors.sort((a, b) => b.amount - a.amount);
  debtors.sort((a, b) => b.amount - a.amount);

  let ci = 0;
  let di = 0;

  while (ci < creditors.length && di < debtors.length) {
    const creditor = creditors[ci];
    const debtor = debtors[di];

    const transferAmount = Math.min(creditor.amount, debtor.amount);
    const rounded = Math.round(transferAmount * 100) / 100;

    if (rounded > 0) {
      transfers.push({
        fromUserId: debtor.uid,
        toUserId: creditor.uid,
        amount: rounded,
      });
    }

    creditor.amount -= transferAmount;
    debtor.amount -= transferAmount;

    if (creditor.amount < EPSILON) ci++;
    if (debtor.amount < EPSILON) di++;
  }

  return transfers;
}

/**
 * Builds net balances across multiple expenses in a group.
 * paidBy gets a positive balance (others owe them); everyone else is negative.
 */
export function computeGroupNetBalances(
  expenseSettlements: Array<{
    paidBy: string;
    breakdown: Array<{ userId: string; totalOwed: number }>;
  }>
): Map<string, number> {
  const net = new Map<string, number>();

  const add = (uid: string, delta: number) => net.set(uid, (net.get(uid) ?? 0) + delta);

  for (const expense of expenseSettlements) {
    for (const b of expense.breakdown) {
      if (b.userId === expense.paidBy) continue; // payer's own share
      add(b.userId, -b.totalOwed); // they owe
      add(expense.paidBy, +b.totalOwed); // payer is owed
    }
  }

  return net;
}

// ─── Group settlement with mode toggle + traceability ─────────────────────────

/**
 * Compute settlements for a group across multiple expenses.
 *
 * - **direct** mode: each person pays exactly who they owe per expense.
 *   Each transfer maps 1:1 to a source expense. No redirection.
 *
 * - **optimized** mode: minimize total transfers via net-balance algorithm.
 *   Each transfer includes best-effort traceability to source expenses.
 */
export function computeGroupSettlement(
  expenses: ExpenseDebt[],
  mode: SettlementMode
): GroupSettlementResult {
  if (mode === 'direct') {
    return computeDirectSettlement(expenses);
  }
  return computeOptimizedSettlement(expenses);
}

/**
 * Direct mode: one transfer per debtor per expense. Full traceability.
 */
function computeDirectSettlement(expenses: ExpenseDebt[]): GroupSettlementResult {
  const transfers: TraceableTransfer[] = [];

  for (const expense of expenses) {
    for (const b of expense.breakdown) {
      if (b.userId === expense.paidBy || b.totalOwed <= 0) continue;
      const amount = Math.round(b.totalOwed * 100) / 100;
      if (amount <= 0) continue;

      transfers.push({
        fromUserId: b.userId,
        toUserId: expense.paidBy,
        amount,
        expenseLinks: [{ expenseId: expense.expenseId, amount }],
      });
    }
  }

  return {
    mode: 'direct',
    transfers,
    totalAmount: transfers.reduce((s, t) => s + t.amount, 0),
  };
}

/**
 * Optimized mode: minimize transfers, then attribute each transfer
 * to source expenses proportionally based on the original debts.
 */
function computeOptimizedSettlement(expenses: ExpenseDebt[]): GroupSettlementResult {
  // Build per-pair, per-expense debt ledger
  // Key: "fromUserId→toUserId", value: array of { expenseId, amount }
  const pairDebts = new Map<string, Array<{ expenseId: string; amount: number }>>();

  for (const expense of expenses) {
    for (const b of expense.breakdown) {
      if (b.userId === expense.paidBy || b.totalOwed <= 0) continue;
      const key = `${b.userId}→${expense.paidBy}`;
      const debts = pairDebts.get(key) ?? [];
      debts.push({ expenseId: expense.expenseId, amount: b.totalOwed });
      pairDebts.set(key, debts);
    }
  }

  // Compute net balances and minimize
  const netBalances = computeGroupNetBalances(expenses);
  const minTransfers = minimizeSettlements(netBalances);

  // For each minimized transfer, build expense links.
  // Net debts from fromUser to toUser come from:
  //   1. Direct debts: fromUser→toUser (positive)
  //   2. Reverse debts: toUser→fromUser (negative, reduces what fromUser owes)
  // After netting, attribute the transfer proportionally across the positive debts.
  const transfers: TraceableTransfer[] = minTransfers.map((transfer) => {
    const directKey = `${transfer.fromUserId}→${transfer.toUserId}`;
    const reverseKey = `${transfer.toUserId}→${transfer.fromUserId}`;

    const directDebts = pairDebts.get(directKey) ?? [];
    const reverseDebts = pairDebts.get(reverseKey) ?? [];

    // Net amount from direct debts
    const totalDirect = directDebts.reduce((s, d) => s + d.amount, 0);
    const totalReverse = reverseDebts.reduce((s, d) => s + d.amount, 0);
    const netDirect = totalDirect - totalReverse;

    // If the transfer direction matches net direct debts, attribute proportionally
    // to the direct expense debts. Otherwise, this transfer was created by the
    // optimizer redirecting through this pair — attribute to the largest debts.
    const expenseLinks: TraceableTransfer['expenseLinks'] = [];

    if (directDebts.length > 0 && netDirect > 0) {
      let remaining = transfer.amount;
      for (const debt of directDebts) {
        if (remaining <= 0) break;
        const proportion = debt.amount / totalDirect;
        const allocated = Math.min(
          Math.round(transfer.amount * proportion * 100) / 100,
          remaining
        );
        if (allocated > 0) {
          expenseLinks.push({ expenseId: debt.expenseId, amount: allocated });
          remaining -= allocated;
        }
      }
      // Absorb any rounding remainder into the last link
      if (remaining > 0.001 && expenseLinks.length > 0) {
        expenseLinks[expenseLinks.length - 1].amount =
          Math.round((expenseLinks[expenseLinks.length - 1].amount + remaining) * 100) / 100;
      }
    }

    return { ...transfer, expenseLinks };
  });

  return {
    mode: 'optimized',
    transfers,
    totalAmount: transfers.reduce((s, t) => s + t.amount, 0),
  };
}
