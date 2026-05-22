import type {
  ChargeComponent,
  Expense,
  ExpenseParticipant,
  LineItem,
  LineItemParticipant,
  SplitInput,
  SplitMethod,
  SplitRule,
} from '@splitmate/types';

const ISO = '2026-01-01T00:00:00Z';

export function makeExpense(o: Partial<Expense> = {}): Expense {
  return {
    id: 'exp-1',
    groupId: 'grp-1',
    title: 'Test Bill',
    description: null,
    totalAmount: 100,
    currency: 'USD',
    category: 'food',
    billType: 'restaurant',
    inputSource: 'manual',
    paidBy: 'u1',
    date: '2026-01-01',
    status: 'active',
    settledAt: null,
    splitMethod: 'itemized',
    createdBy: 'u1',
    createdAt: ISO,
    updatedAt: ISO,
    ...o,
  };
}

export function makeParticipant(
  userId: string,
  o: Partial<ExpenseParticipant> = {},
): ExpenseParticipant {
  return {
    id: `ep-${userId}`,
    expenseId: 'exp-1',
    userId,
    isIncluded: true,
    owedAmount: 0,
    paidAmount: 0,
    createdAt: ISO,
    ...o,
  };
}

export function makeItem(o: Partial<LineItem> & Pick<LineItem, 'id' | 'name' | 'totalPrice'>): LineItem {
  return {
    expenseId: 'exp-1',
    quantity: 1,
    unitPrice: o.totalPrice,
    position: 0,
    category: 'other',
    createdAt: ISO,
    updatedAt: ISO,
    ...o,
  };
}

export function lip(lineItemId: string, userId: string, shares = 1): LineItemParticipant {
  return {
    id: `lip-${lineItemId}-${userId}`,
    lineItemId,
    userId,
    shares,
    createdAt: ISO,
  };
}

export function makeCharge(
  o: Partial<ChargeComponent> & Pick<ChargeComponent, 'id' | 'type' | 'label' | 'amount'>,
): ChargeComponent {
  return {
    expenseId: 'exp-1',
    rate: null,
    allocationRule: 'proportional_subtotal',
    excludedUserIds: [],
    position: 0,
    createdAt: ISO,
    ...o,
  };
}

export function makeRule(method: SplitMethod = 'itemized'): SplitRule {
  return { id: 'rule-1', expenseId: 'exp-1', method, overrides: {} };
}

export function input(
  o: {
    expense?: Partial<Expense>;
    lineItems?: LineItem[];
    lineItemParticipants?: LineItemParticipant[];
    chargeComponents?: ChargeComponent[];
    splitRule?: SplitRule;
    participants?: ExpenseParticipant[];
  } = {},
): SplitInput {
  return {
    expense: makeExpense(o.expense),
    lineItems: o.lineItems ?? [],
    lineItemParticipants: o.lineItemParticipants ?? [],
    chargeComponents: o.chargeComponents ?? [],
    splitRule: o.splitRule ?? makeRule(),
    participants: o.participants ?? [],
  };
}

/** Helper: pull totalOwed for a user from a SplitResult. */
export function owedOf(result: { byUser: Array<{ userId: string; totalOwed: number }> }, userId: string): number {
  const u = result.byUser.find((x) => x.userId === userId);
  return u ? u.totalOwed : 0;
}

/** Helper: sum of all user totals. */
export function sumOwed(result: { byUser: Array<{ totalOwed: number }> }): number {
  return Math.round(result.byUser.reduce((s, u) => s + u.totalOwed, 0) * 100) / 100;
}
