// --- Categorical types (string-literal unions that mirror the CHECK constraints) ---

/** Drives default fee/tax rules + which UI form the user sees. */
export type BillType =
  | 'restaurant'
  | 'grocery'
  | 'delivery'
  | 'utility'
  | 'subscription'
  | 'accommodation'
  | 'custom';

/** High-level expense category (for analytics/reporting). */
export type ExpenseCategory =
  | 'food'
  | 'travel'
  | 'accommodation'
  | 'utility'
  | 'entertainment'
  | 'other';

export type ExpenseStatus = 'active' | 'settled' | 'archived';

export type InputSource = 'ocr' | 'manual' | 'upload';

/** How the bill is divided across participants. Lives here because the DB
 *  column `expenses.split_method` enforces it. The split engine (Phase 7)
 *  imports this type. */
export type SplitMethod = 'equal' | 'itemized' | 'exact' | 'percentage';

/** Per-line-item category. Drives alcohol-tax allocation in the engine. */
export type ItemCategory = 'food' | 'alcohol' | 'non_taxable' | 'other';

/** Non-item monetary components of a bill. */
export type ChargeType =
  | 'tax'
  | 'tip'
  | 'service'
  | 'delivery'
  | 'platform'
  | 'surge'
  | 'discount'
  | 'bag_fee'
  | 'other';

/** How a charge is divided across participants. */
export type AllocationRule =
  | 'proportional_subtotal'
  | 'proportional_order_value'
  | 'equal_per_person'
  | 'flat_per_person'
  | 'item_specific'
  | 'alcohol_only';

// --- Records ---

export type Expense = {
  id: string;
  groupId: string;
  title: string;
  description: string | null;
  totalAmount: number;
  currency: string;
  category: ExpenseCategory;
  billType: BillType;
  inputSource: InputSource;
  paidBy: string;
  /** ISO date string `YYYY-MM-DD` (no time component). */
  date: string;
  status: ExpenseStatus;
  /** Set by the `set_expense_settled_at` trigger on status -> 'settled'. */
  settledAt: string | null;
  splitMethod: SplitMethod;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type LineItem = {
  id: string;
  expenseId: string;
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  category: ItemCategory;
  position: number;
  createdAt: string;
  updatedAt: string;
};

export type LineItemParticipant = {
  id: string;
  lineItemId: string;
  userId: string;
  /** Share weight. 1 = sole claim. 0.5+0.5 = split with one other person.
   *  For quantity splits (e.g. 2 of 3 beers), shares can be the integer count. */
  shares: number;
  createdAt: string;
};

export type ChargeComponent = {
  id: string;
  expenseId: string;
  type: ChargeType;
  label: string;
  amount: number;
  /** Optional percent (e.g. 0.05 = 5%). Used for tax/service charges that
   *  carry a rate. Null when only the absolute amount matters. */
  rate: number | null;
  allocationRule: AllocationRule;
  /** Users explicitly excluded from this charge (e.g. teetotalers on
   *  alcohol tax). Empty array when everyone participates. */
  excludedUserIds: string[];
  position: number;
  createdAt: string;
};

export type ExpenseParticipant = {
  id: string;
  expenseId: string;
  userId: string;
  isIncluded: boolean;
  /** Engine-written. 0 until the split is computed and committed. */
  owedAmount: number;
  /** Non-zero only for the payer when they paid the full amount up front. */
  paidAmount: number;
  createdAt: string;
};
