export type SettlementStatus = 'pending' | 'completed';

/**
 * A user-declared payment from one group member to another.
 * Inserted only by the payer (`from_user_id = auth.uid()`) per RLS.
 */
export type Settlement = {
  id: string;
  groupId: string;
  fromUserId: string;
  toUserId: string;
  amount: number;
  currency: string;
  status: SettlementStatus;
  settledAt: string | null;
  note: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Junction row linking a settlement back to the expense(s) it covered.
 * Powers the "this $30 covers $20 from dinner and $10 from groceries" trace.
 */
export type SettlementExpenseLink = {
  id: string;
  settlementId: string;
  expenseId: string;
  amountFromExpense: number;
  createdAt: string;
};

// --- Engine I/O for settlement optimization ---

/**
 * Input to the settlement optimizer. One per active expense.
 * `breakdown` is the per-user owed amount as computed by the split engine.
 */
export type ExpenseDebt = {
  expenseId: string;
  paidBy: string;
  breakdown: Array<{ userId: string; totalOwed: number }>;
};

/**
 * A single source-bill contribution to a transfer.
 * `amount` is how much of that transfer came from that expense.
 */
export type ExpenseLink = {
  expenseId: string;
  amount: number;
};

/**
 * Output of the settlement optimizer. Each transfer carries provenance
 * so the UI can say "you owe Yesh $30 — $20 from dinner, $10 from groceries".
 */
export type TraceableTransfer = {
  fromUserId: string;
  toUserId: string;
  amount: number;
  currency: string;
  expenseLinks: ExpenseLink[];
};
