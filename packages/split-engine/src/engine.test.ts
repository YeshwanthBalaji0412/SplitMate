import { describe, it, expect } from 'vitest';
import { computeSplit, formatAmount } from './engine';
import type { SplitInput, Expense, LineItem, LineItemParticipant, ChargeComponent, ExpenseParticipant, SplitRule } from '@split-smart/types';

// ─── Test fixtures ────────────────────────────────────────────────────────────

const makeExpense = (overrides: Partial<Expense> = {}): Expense => ({
  id: 'exp-1',
  groupId: 'grp-1',
  title: 'Dinner',
  totalAmount: 100,
  currency: 'USD',
  category: 'food',
  billType: 'restaurant',
  paidBy: 'user-A',
  date: '2026-03-31',
  status: 'active',
  splitMethod: 'equal',
  createdBy: 'user-A',
  createdAt: '2026-03-31T00:00:00Z',
  updatedAt: '2026-03-31T00:00:00Z',
  ...overrides,
});

const makeParticipant = (userId: string, overrides: Partial<ExpenseParticipant> = {}): ExpenseParticipant => ({
  id: `part-${userId}`,
  expenseId: 'exp-1',
  userId,
  owedAmount: 0,
  paidAmount: 0,
  isIncluded: true,
  ...overrides,
});

const makeSplitRule = (overrides: Partial<SplitRule> = {}): SplitRule => ({
  id: 'rule-1',
  expenseId: 'exp-1',
  method: 'equal',
  overrides: {},
  ...overrides,
});

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('computeSplit — equal split, no line items', () => {
  it('splits $90 equally among 3 people', () => {
    const input: SplitInput = {
      expense: makeExpense({ totalAmount: 90 }),
      lineItems: [],
      lineItemParticipants: [],
      chargeComponents: [],
      splitRule: makeSplitRule(),
      participants: [
        makeParticipant('user-A'),
        makeParticipant('user-B'),
        makeParticipant('user-C'),
      ],
    };

    const result = computeSplit(input);

    expect(result.breakdown).toHaveLength(3);
    const total = result.breakdown.reduce((s, b) => s + b.totalOwed, 0);
    expect(Math.round(total * 100) / 100).toBe(result.totalVerified);
  });
});

describe('computeSplit — itemized split with tax', () => {
  it('splits items by consumption and tax proportionally', () => {
    const lineItems: LineItem[] = [
      { id: 'li-1', expenseId: 'exp-1', name: 'Pasta', quantity: 1, unitPrice: 30, totalPrice: 30, position: 0 },
      { id: 'li-2', expenseId: 'exp-1', name: 'Pizza', quantity: 1, unitPrice: 20, totalPrice: 20, position: 1 },
    ];

    const lineItemParticipants: LineItemParticipant[] = [
      { id: 'lip-1', lineItemId: 'li-1', userId: 'user-A', shares: 1 },
      { id: 'lip-2', lineItemId: 'li-2', userId: 'user-B', shares: 1 },
    ];

    const taxCharge: ChargeComponent = {
      id: 'charge-tax',
      expenseId: 'exp-1',
      type: 'sales_tax',
      label: 'Sales Tax (10%)',
      amount: 5,
      rate: 0.1,
      allocationRule: 'proportional_to_subtotal',
      excludedUserIds: [],
      position: 1,
    };

    const input: SplitInput = {
      expense: makeExpense({ totalAmount: 55, splitMethod: 'itemized' }),
      lineItems,
      lineItemParticipants,
      chargeComponents: [taxCharge],
      splitRule: makeSplitRule({ method: 'itemized' }),
      participants: [makeParticipant('user-A'), makeParticipant('user-B')],
    };

    const result = computeSplit(input);

    const alice = result.breakdown.find((b) => b.userId === 'user-A')!;
    const bob = result.breakdown.find((b) => b.userId === 'user-B')!;

    expect(alice.itemSubtotal).toBe(30);
    expect(bob.itemSubtotal).toBe(20);

    const aliceTax = alice.chargeBreakdown.find((c) => c.chargeId === 'charge-tax')!;
    const bobTax = bob.chargeBreakdown.find((c) => c.chargeId === 'charge-tax')!;
    expect(aliceTax.amount).toBe(3);
    expect(bobTax.amount).toBe(2);

    expect(alice.totalOwed).toBe(33);
    expect(bob.totalOwed).toBe(22);

    expect(result.totalVerified).toBe(55);
  });
});

describe('computeSplit — discount handling', () => {
  it('applies discount as negative charge', () => {
    const discount: ChargeComponent = {
      id: 'charge-disc',
      expenseId: 'exp-1',
      type: 'discount',
      label: 'Promo Discount',
      amount: 10,
      allocationRule: 'equal',
      excludedUserIds: [],
      position: 1,
    };

    const input: SplitInput = {
      expense: makeExpense({ totalAmount: 90 }),
      lineItems: [],
      lineItemParticipants: [],
      chargeComponents: [discount],
      splitRule: makeSplitRule(),
      participants: [makeParticipant('user-A'), makeParticipant('user-B')],
    };

    const result = computeSplit(input);

    for (const b of result.breakdown) {
      const disc = b.chargeBreakdown.find((c) => c.chargeId === 'charge-disc')!;
      expect(disc.amount).toBe(-5);
    }
  });
});

describe('computeSplit — excluded participant', () => {
  it('excludes a member from fee distribution', () => {
    const deliveryFee: ChargeComponent = {
      id: 'charge-delivery',
      expenseId: 'exp-1',
      type: 'delivery_fee',
      label: 'Delivery Fee',
      amount: 4,
      allocationRule: 'equal',
      excludedUserIds: ['user-C'],
      position: 1,
    };

    const input: SplitInput = {
      expense: makeExpense({ totalAmount: 100 }),
      lineItems: [],
      lineItemParticipants: [],
      chargeComponents: [deliveryFee],
      splitRule: makeSplitRule(),
      participants: [
        makeParticipant('user-A'),
        makeParticipant('user-B'),
        makeParticipant('user-C'),
      ],
    };

    const result = computeSplit(input);

    const charlie = result.breakdown.find((b) => b.userId === 'user-C')!;
    const charlieDelivery = charlie.chargeBreakdown.find((c) => c.chargeId === 'charge-delivery');
    expect(charlieDelivery).toBeUndefined();

    const alice = result.breakdown.find((b) => b.userId === 'user-A')!;
    const aliceDelivery = alice.chargeBreakdown.find((c) => c.chargeId === 'charge-delivery')!;
    expect(aliceDelivery.amount).toBe(2);
  });
});

describe('computeSplit — rounding', () => {
  it('ensures total always equals expense.totalAmount after rounding', () => {
    const input: SplitInput = {
      expense: makeExpense({ totalAmount: 10 }),
      lineItems: [],
      lineItemParticipants: [],
      chargeComponents: [],
      splitRule: makeSplitRule(),
      participants: [
        makeParticipant('user-A'),
        makeParticipant('user-B'),
        makeParticipant('user-C'),
      ],
    };

    const result = computeSplit(input);
    const sum = result.breakdown.reduce((s, b) => s + b.totalOwed, 0);
    expect(Math.round(sum * 100) / 100).toBe(result.totalVerified);
  });
});

// ─── Fee rule ordering (discount → tax → fee) ────────────────────────────────

describe('computeSplit — discount-before-tax ordering', () => {
  it('taxes are computed on post-discount subtotals, not original', () => {
    // Alice: $100 food item, Bob: $100 food item. Subtotals: 100 each.
    // $40 discount (equal), then 10% tax proportional to post-discount subtotals.
    // Post-discount: Alice $80, Bob $80.
    // Tax on $160 post-discount base = $16, split 50/50 = $8 each.
    // Total per person: $80 (items) - $20 (discount) + $8 (tax) = $68.
    const lineItems: LineItem[] = [
      { id: 'li-1', expenseId: 'exp-1', name: 'Steak', quantity: 1, unitPrice: 100, totalPrice: 100, position: 0 },
      { id: 'li-2', expenseId: 'exp-1', name: 'Lobster', quantity: 1, unitPrice: 100, totalPrice: 100, position: 1 },
    ];

    const lineItemParticipants: LineItemParticipant[] = [
      { id: 'lip-1', lineItemId: 'li-1', userId: 'user-A', shares: 1 },
      { id: 'lip-2', lineItemId: 'li-2', userId: 'user-B', shares: 1 },
    ];

    const discount: ChargeComponent = {
      id: 'charge-disc',
      expenseId: 'exp-1',
      type: 'discount',
      label: 'Happy Hour 20% Off',
      amount: 40,
      allocationRule: 'equal',
      excludedUserIds: [],
      position: 3, // position doesn't matter — discounts always applied first
    };

    const tax: ChargeComponent = {
      id: 'charge-tax',
      expenseId: 'exp-1',
      type: 'sales_tax',
      label: 'Sales Tax (10%)',
      amount: 16,
      rate: 0.1,
      allocationRule: 'proportional_to_subtotal',
      excludedUserIds: [],
      position: 1, // lower position than discount — but discount still goes first
    };

    const input: SplitInput = {
      expense: makeExpense({ totalAmount: 176 }), // 200 - 40 + 16
      lineItems,
      lineItemParticipants,
      chargeComponents: [tax, discount], // intentionally tax first in array
      splitRule: makeSplitRule({ method: 'itemized' }),
      participants: [makeParticipant('user-A'), makeParticipant('user-B')],
    };

    const result = computeSplit(input);
    const alice = result.breakdown.find((b) => b.userId === 'user-A')!;
    const bob = result.breakdown.find((b) => b.userId === 'user-B')!;

    // Discount applied first
    const aliceDisc = alice.chargeBreakdown.find((c) => c.type === 'discount')!;
    expect(aliceDisc.amount).toBe(-20);

    // Tax is proportional to post-discount subtotals (80:80 = 50/50)
    const aliceTax = alice.chargeBreakdown.find((c) => c.type === 'sales_tax')!;
    expect(aliceTax.amount).toBe(8); // 16 * (80/160) = 8

    expect(alice.totalOwed).toBe(88); // 100 - 20 + 8
    expect(bob.totalOwed).toBe(88);
    expect(result.totalVerified).toBe(176);
  });

  it('discount-before-tax changes proportional allocation with unequal items', () => {
    // Alice: $60, Bob: $40. Total items: $100.
    // $20 proportional discount. Alice gets $12 off, Bob gets $8 off.
    // Post-discount: Alice $48, Bob $32. Ratio: 60:40.
    // Tax $10 proportional to post-discount: Alice $6, Bob $4.
    const lineItems: LineItem[] = [
      { id: 'li-1', expenseId: 'exp-1', name: 'Expensive item', quantity: 1, unitPrice: 60, totalPrice: 60, position: 0 },
      { id: 'li-2', expenseId: 'exp-1', name: 'Cheap item', quantity: 1, unitPrice: 40, totalPrice: 40, position: 1 },
    ];

    const lineItemParticipants: LineItemParticipant[] = [
      { id: 'lip-1', lineItemId: 'li-1', userId: 'user-A', shares: 1 },
      { id: 'lip-2', lineItemId: 'li-2', userId: 'user-B', shares: 1 },
    ];

    const discount: ChargeComponent = {
      id: 'disc',
      expenseId: 'exp-1',
      type: 'discount',
      label: 'Coupon',
      amount: 20,
      allocationRule: 'proportional_to_subtotal',
      excludedUserIds: [],
      position: 0,
    };

    const tax: ChargeComponent = {
      id: 'tax',
      expenseId: 'exp-1',
      type: 'sales_tax',
      label: 'Tax',
      amount: 10,
      allocationRule: 'proportional_to_subtotal',
      excludedUserIds: [],
      position: 1,
    };

    const input: SplitInput = {
      expense: makeExpense({ totalAmount: 90 }), // 100 - 20 + 10
      lineItems,
      lineItemParticipants,
      chargeComponents: [discount, tax],
      splitRule: makeSplitRule({ method: 'itemized' }),
      participants: [makeParticipant('user-A'), makeParticipant('user-B')],
    };

    const result = computeSplit(input);
    const alice = result.breakdown.find((b) => b.userId === 'user-A')!;
    const bob = result.breakdown.find((b) => b.userId === 'user-B')!;

    // Discount: proportional to original subtotals (60:40)
    expect(alice.chargeBreakdown.find((c) => c.type === 'discount')!.amount).toBe(-12);
    expect(bob.chargeBreakdown.find((c) => c.type === 'discount')!.amount).toBe(-8);

    // Tax: proportional to post-discount subtotals (48:32 = 60:40 same ratio here)
    expect(alice.chargeBreakdown.find((c) => c.type === 'sales_tax')!.amount).toBe(6);
    expect(bob.chargeBreakdown.find((c) => c.type === 'sales_tax')!.amount).toBe(4);

    expect(alice.totalOwed).toBe(54); // 60 - 12 + 6
    expect(bob.totalOwed).toBe(36);   // 40 - 8 + 4
    expect(result.totalVerified).toBe(90);
  });

  it('fees come after taxes', () => {
    // Verify delivery fee uses post-discount subtotals too
    const lineItems: LineItem[] = [
      { id: 'li-1', expenseId: 'exp-1', name: 'Food', quantity: 1, unitPrice: 50, totalPrice: 50, position: 0 },
    ];

    const lineItemParticipants: LineItemParticipant[] = [
      { id: 'lip-1', lineItemId: 'li-1', userId: 'user-A', shares: 1 },
    ];

    const charges: ChargeComponent[] = [
      { id: 'fee', expenseId: 'exp-1', type: 'delivery_fee', label: 'Delivery', amount: 5, allocationRule: 'equal', excludedUserIds: [], position: 0 },
      { id: 'disc', expenseId: 'exp-1', type: 'discount', label: 'Discount', amount: 10, allocationRule: 'equal', excludedUserIds: [], position: 1 },
      { id: 'tax', expenseId: 'exp-1', type: 'sales_tax', label: 'Tax', amount: 4, allocationRule: 'proportional_to_subtotal', excludedUserIds: [], position: 2 },
    ];

    const input: SplitInput = {
      expense: makeExpense({ totalAmount: 49 }), // 50 - 10 + 4 + 5
      lineItems,
      lineItemParticipants,
      chargeComponents: charges,
      splitRule: makeSplitRule({ method: 'itemized' }),
      participants: [makeParticipant('user-A')],
    };

    const result = computeSplit(input);
    const alice = result.breakdown[0];

    // Order in breakdown should be: discount, tax, fee
    const types = alice.chargeBreakdown.map((c) => c.type);
    expect(types).toEqual(['discount', 'sales_tax', 'delivery_fee']);
  });
});

// ─── Currency formatting ──────────────────────────────────────────────────────

describe('formatAmount', () => {
  it('formats USD with $ symbol', () => {
    expect(formatAmount(42.5, 'USD')).toBe('$42.50');
  });

  it('formats INR with ₹ symbol', () => {
    expect(formatAmount(599, 'INR')).toBe('₹599.00');
  });

  it('uses currency code for unknown currencies', () => {
    expect(formatAmount(100, 'EUR')).toBe('EUR 100.00');
  });
});

describe('computeSplit — INR currency in explanation', () => {
  it('produces ₹ symbol in explanation for Indian bills', () => {
    const lineItems: LineItem[] = [
      { id: 'li-1', expenseId: 'exp-1', name: 'Butter Chicken', quantity: 1, unitPrice: 320, totalPrice: 320, position: 0 },
    ];
    const lineItemParticipants: LineItemParticipant[] = [
      { id: 'lip-1', lineItemId: 'li-1', userId: 'user-A', shares: 1 },
    ];

    const gst: ChargeComponent = {
      id: 'gst',
      expenseId: 'exp-1',
      type: 'sales_tax',
      label: 'GST @ 5%',
      amount: 16,
      rate: 0.05,
      allocationRule: 'proportional_to_subtotal',
      excludedUserIds: [],
      position: 1,
    };

    const input: SplitInput = {
      expense: makeExpense({ totalAmount: 336, currency: 'INR', billType: 'restaurant' }),
      lineItems,
      lineItemParticipants,
      chargeComponents: [gst],
      splitRule: makeSplitRule(),
      participants: [makeParticipant('user-A')],
    };

    const result = computeSplit(input);
    expect(result.breakdown[0].explanation).toContain('₹');
    expect(result.breakdown[0].explanation).not.toContain('$');
  });
});
