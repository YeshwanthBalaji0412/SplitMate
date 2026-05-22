import type {
  ChargeComponent,
  Expense,
  ExpenseParticipant,
  LineItem,
  LineItemParticipant,
  SplitMethod,
} from './expense';

// Re-exported here so engine consumers only need to import from this file.
export type { SplitMethod };

/**
 * Per-bill split configuration. `method` matches the column on `expenses`;
 * `overrides` is a free-form bag for per-bill rule tweaks (e.g. force a
 * specific allocation rule on one charge). The shape of `overrides` is
 * defined by the engine implementation in Phase 7.
 */
export type SplitRule = {
  id: string;
  expenseId: string;
  method: SplitMethod;
  overrides: Record<string, unknown>;
};

/**
 * One traced line in a user's per-person receipt.
 * `type` says what kind of line this is; `amount` is the user's share of it.
 * `note` is a short human label (e.g. "1/2 share", "proportional to $42 order").
 */
export type SplitBreakdownEntry = {
  type: 'item' | 'charge' | 'tax' | 'discount' | 'subtotal';
  description: string;
  amount: number;
  note?: string;
};

/**
 * Output of `computeSplit`. The engine emits a per-user breakdown so the
 * UI never has to re-derive money math; it just renders these entries.
 */
export type SplitResult = {
  expenseId: string;
  currency: string;
  byUser: Array<{
    userId: string;
    totalOwed: number;
    entries: SplitBreakdownEntry[];
  }>;
};

/**
 * Bundled input for `computeSplit`. All references live in TypeScript
 * objects (no DB calls inside the engine) so it stays fully unit-testable.
 */
export type SplitInput = {
  expense: Expense;
  lineItems: LineItem[];
  lineItemParticipants: LineItemParticipant[];
  chargeComponents: ChargeComponent[];
  splitRule: SplitRule;
  participants: ExpenseParticipant[];
};
