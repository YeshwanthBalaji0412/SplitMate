/**
 * Settlement minimization — reduces N*(N-1)/2 potential transfers to at most N-1.
 *
 * Algorithm: net-balance approach.
 * 1. Compute each person's net balance (positive = is owed money, negative = owes money).
 * 2. Greedily match the biggest creditor with the biggest debtor until all balances are zero.
 *
 * This produces the minimum number of transactions needed to settle the group.
 */

export interface Transfer {
  fromUserId: string;
  toUserId: string;
  amount: number;
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
