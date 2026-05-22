import { describe, expect, it } from 'vitest';
import { computeSplit } from '../src/engine';
import { input, lip, makeCharge, makeItem, makeParticipant, makeRule, owedOf, sumOwed } from './fixtures';

describe('computeSplit -- equal method', () => {
  it('1. equal split between 2 users gives each half the total', () => {
    const result = computeSplit(
      input({
        expense: { totalAmount: 100, splitMethod: 'equal' },
        splitRule: makeRule('equal'),
        participants: [makeParticipant('u1'), makeParticipant('u2')],
      }),
    );
    expect(owedOf(result, 'u1')).toBe(50);
    expect(owedOf(result, 'u2')).toBe(50);
    expect(sumOwed(result)).toBe(100);
  });

  it('2. equal split between 3 users adjusts leftover so sum equals total', () => {
    const result = computeSplit(
      input({
        expense: { totalAmount: 100, splitMethod: 'equal' },
        splitRule: makeRule('equal'),
        participants: [makeParticipant('u1'), makeParticipant('u2'), makeParticipant('u3')],
      }),
    );
    expect(sumOwed(result)).toBe(100);
    // Two get 33.33, one gets 33.34 (the leftover-cent recipient -- highest
    // value by absolute, tie-broken lex -> the first ID alphabetically).
    const amounts = result.byUser.map((u) => u.totalOwed).sort();
    expect(amounts).toEqual([33.33, 33.33, 33.34]);
  });
});

describe('computeSplit -- itemized basics', () => {
  it('3. itemized: one item per user yields their item totals', () => {
    const result = computeSplit(
      input({
        expense: { totalAmount: 100, splitMethod: 'itemized' },
        lineItems: [
          makeItem({ id: 'i1', name: 'Salmon', totalPrice: 50 }),
          makeItem({ id: 'i2', name: 'Salad', totalPrice: 50 }),
        ],
        lineItemParticipants: [lip('i1', 'u1'), lip('i2', 'u2')],
        participants: [makeParticipant('u1'), makeParticipant('u2')],
      }),
    );
    expect(owedOf(result, 'u1')).toBe(50);
    expect(owedOf(result, 'u2')).toBe(50);
  });

  it('4. shared item split (1+1 shares) divides evenly', () => {
    const result = computeSplit(
      input({
        expense: { totalAmount: 30, splitMethod: 'itemized' },
        lineItems: [makeItem({ id: 'i1', name: 'Pizza', totalPrice: 30 })],
        lineItemParticipants: [lip('i1', 'u1', 1), lip('i1', 'u2', 1)],
        participants: [makeParticipant('u1'), makeParticipant('u2')],
      }),
    );
    expect(owedOf(result, 'u1')).toBe(15);
    expect(owedOf(result, 'u2')).toBe(15);
  });

  it('5. shared item with uneven shares (2/3 vs 1/3)', () => {
    const result = computeSplit(
      input({
        expense: { totalAmount: 30, splitMethod: 'itemized' },
        lineItems: [makeItem({ id: 'i1', name: 'Pizza', totalPrice: 30 })],
        lineItemParticipants: [lip('i1', 'u1', 2), lip('i1', 'u2', 1)],
        participants: [makeParticipant('u1'), makeParticipant('u2')],
      }),
    );
    expect(owedOf(result, 'u1')).toBe(20);
    expect(owedOf(result, 'u2')).toBe(10);
  });
});

describe('computeSplit -- charge ordering', () => {
  it('6. discount is applied BEFORE tax (tax is on post-discount base)', () => {
    // Items: u1=$80, u2=$20.
    // Discount $20 equal_per_person  -> each gets -$10. Post-discount: u1=$70, u2=$10.
    // Tax $8 proportional_subtotal (uses postDiscount) -> u1=$7, u2=$1.
    // Final: u1 = 80 - 10 + 7 = 77. u2 = 20 - 10 + 1 = 11. Total = 88.
    const result = computeSplit(
      input({
        expense: { totalAmount: 88 },
        lineItems: [
          makeItem({ id: 'i1', name: 'Big', totalPrice: 80 }),
          makeItem({ id: 'i2', name: 'Small', totalPrice: 20 }),
        ],
        lineItemParticipants: [lip('i1', 'u1'), lip('i2', 'u2')],
        chargeComponents: [
          makeCharge({ id: 'c1', type: 'discount', label: 'Promo', amount: 20, allocationRule: 'equal_per_person', position: 0 }),
          makeCharge({ id: 'c2', type: 'tax', label: 'Tax', amount: 8, allocationRule: 'proportional_subtotal', position: 1 }),
        ],
        participants: [makeParticipant('u1'), makeParticipant('u2')],
      }),
    );
    expect(owedOf(result, 'u1')).toBe(77);
    expect(owedOf(result, 'u2')).toBe(11);
    expect(sumOwed(result)).toBe(88);
  });
});

describe('computeSplit -- tax allocation', () => {
  it('7. proportional tax allocation tracks each user’s share of the subtotal', () => {
    // u1 $80, u2 $20. Tax $10 proportional_subtotal.
    // u1: 80 + 8 = 88. u2: 20 + 2 = 22. Total 110.
    const result = computeSplit(
      input({
        expense: { totalAmount: 110 },
        lineItems: [
          makeItem({ id: 'i1', name: 'Big', totalPrice: 80 }),
          makeItem({ id: 'i2', name: 'Small', totalPrice: 20 }),
        ],
        lineItemParticipants: [lip('i1', 'u1'), lip('i2', 'u2')],
        chargeComponents: [makeCharge({ id: 'c1', type: 'tax', label: 'Sales tax', amount: 10 })],
        participants: [makeParticipant('u1'), makeParticipant('u2')],
      }),
    );
    expect(owedOf(result, 'u1')).toBe(88);
    expect(owedOf(result, 'u2')).toBe(22);
  });

  it('8. alcohol-only tax falls on alcohol claimants only', () => {
    // Food $40 shared. Alcohol $20 sole to u1. Alcohol tax $5 alcohol_only.
    // u1: 20 (half food) + 20 (alcohol) + 5 (alcohol tax) = 45.
    // u2: 20 (half food) + 0 + 0 = 20.
    const result = computeSplit(
      input({
        expense: { totalAmount: 65 },
        lineItems: [
          makeItem({ id: 'food', name: 'Food', totalPrice: 40, category: 'food' }),
          makeItem({ id: 'alc', name: 'Beer', totalPrice: 20, category: 'alcohol' }),
        ],
        lineItemParticipants: [
          lip('food', 'u1'),
          lip('food', 'u2'),
          lip('alc', 'u1'),
        ],
        chargeComponents: [
          makeCharge({ id: 'tax', type: 'tax', label: 'Alcohol tax', amount: 5, allocationRule: 'alcohol_only' }),
        ],
        participants: [makeParticipant('u1'), makeParticipant('u2')],
      }),
    );
    expect(owedOf(result, 'u1')).toBe(45);
    expect(owedOf(result, 'u2')).toBe(20);
  });
});

describe('computeSplit -- fees', () => {
  it('9. delivery fee proportional to order value', () => {
    // u1 $40, u2 $60. Delivery $10 proportional_order_value.
    // u1: 40 + 4 = 44. u2: 60 + 6 = 66.
    const result = computeSplit(
      input({
        expense: { totalAmount: 110 },
        lineItems: [
          makeItem({ id: 'i1', name: 'Small', totalPrice: 40 }),
          makeItem({ id: 'i2', name: 'Big', totalPrice: 60 }),
        ],
        lineItemParticipants: [lip('i1', 'u1'), lip('i2', 'u2')],
        chargeComponents: [
          makeCharge({ id: 'd', type: 'delivery', label: 'Delivery', amount: 10, allocationRule: 'proportional_order_value' }),
        ],
        participants: [makeParticipant('u1'), makeParticipant('u2')],
      }),
    );
    expect(owedOf(result, 'u1')).toBe(44);
    expect(owedOf(result, 'u2')).toBe(66);
  });

  it('10. platform fee equal per person', () => {
    // 3 users, items already equal $10 each. Platform fee $9 equal_per_person -> +$3 each.
    const result = computeSplit(
      input({
        expense: { totalAmount: 39 },
        lineItems: [
          makeItem({ id: 'i1', name: 'A', totalPrice: 10 }),
          makeItem({ id: 'i2', name: 'B', totalPrice: 10 }),
          makeItem({ id: 'i3', name: 'C', totalPrice: 10 }),
        ],
        lineItemParticipants: [lip('i1', 'u1'), lip('i2', 'u2'), lip('i3', 'u3')],
        chargeComponents: [
          makeCharge({ id: 'p', type: 'platform', label: 'Platform fee', amount: 9, allocationRule: 'equal_per_person' }),
        ],
        participants: [makeParticipant('u1'), makeParticipant('u2'), makeParticipant('u3')],
      }),
    );
    expect(owedOf(result, 'u1')).toBe(13);
    expect(owedOf(result, 'u2')).toBe(13);
    expect(owedOf(result, 'u3')).toBe(13);
  });

  it('11. tip proportional to subtotal', () => {
    // u1 $80, u2 $20. Tip $15 proportional_subtotal -> u1 +$12, u2 +$3.
    const result = computeSplit(
      input({
        expense: { totalAmount: 115 },
        lineItems: [
          makeItem({ id: 'i1', name: 'Big', totalPrice: 80 }),
          makeItem({ id: 'i2', name: 'Small', totalPrice: 20 }),
        ],
        lineItemParticipants: [lip('i1', 'u1'), lip('i2', 'u2')],
        chargeComponents: [makeCharge({ id: 't', type: 'tip', label: 'Tip', amount: 15 })],
        participants: [makeParticipant('u1'), makeParticipant('u2')],
      }),
    );
    expect(owedOf(result, 'u1')).toBe(92);
    expect(owedOf(result, 'u2')).toBe(23);
  });

  it('12. service fee proportional to subtotal', () => {
    // Same proportional math as tip, different charge type.
    const result = computeSplit(
      input({
        expense: { totalAmount: 110 },
        lineItems: [
          makeItem({ id: 'i1', name: 'Big', totalPrice: 60 }),
          makeItem({ id: 'i2', name: 'Small', totalPrice: 40 }),
        ],
        lineItemParticipants: [lip('i1', 'u1'), lip('i2', 'u2')],
        chargeComponents: [makeCharge({ id: 's', type: 'service', label: 'Service', amount: 10 })],
        participants: [makeParticipant('u1'), makeParticipant('u2')],
      }),
    );
    expect(owedOf(result, 'u1')).toBe(66);
    expect(owedOf(result, 'u2')).toBe(44);
  });
});

describe('computeSplit -- discount conventions', () => {
  it('13. negative discount amount is treated the same as positive (magnitude reduction)', () => {
    // Items: u1=$50, u2=$50. Discount stored as amount=-10. equal_per_person.
    // Each user -> -$5. Total = $90.
    const result = computeSplit(
      input({
        expense: { totalAmount: 90 },
        lineItems: [
          makeItem({ id: 'i1', name: 'A', totalPrice: 50 }),
          makeItem({ id: 'i2', name: 'B', totalPrice: 50 }),
        ],
        lineItemParticipants: [lip('i1', 'u1'), lip('i2', 'u2')],
        chargeComponents: [
          makeCharge({ id: 'd', type: 'discount', label: 'Promo', amount: -10, allocationRule: 'equal_per_person' }),
        ],
        participants: [makeParticipant('u1'), makeParticipant('u2')],
      }),
    );
    expect(owedOf(result, 'u1')).toBe(45);
    expect(owedOf(result, 'u2')).toBe(45);
  });

  it('14. positive discount amount produces identical result to the negative form', () => {
    const result = computeSplit(
      input({
        expense: { totalAmount: 90 },
        lineItems: [
          makeItem({ id: 'i1', name: 'A', totalPrice: 50 }),
          makeItem({ id: 'i2', name: 'B', totalPrice: 50 }),
        ],
        lineItemParticipants: [lip('i1', 'u1'), lip('i2', 'u2')],
        chargeComponents: [
          makeCharge({ id: 'd', type: 'discount', label: 'Promo', amount: 10, allocationRule: 'equal_per_person' }),
        ],
        participants: [makeParticipant('u1'), makeParticipant('u2')],
      }),
    );
    expect(owedOf(result, 'u1')).toBe(45);
    expect(owedOf(result, 'u2')).toBe(45);
  });
});

describe('computeSplit -- edge cases', () => {
  it('15. zero-charge bill: totals are just item subtotals', () => {
    const result = computeSplit(
      input({
        expense: { totalAmount: 100 },
        lineItems: [
          makeItem({ id: 'i1', name: 'A', totalPrice: 60 }),
          makeItem({ id: 'i2', name: 'B', totalPrice: 40 }),
        ],
        lineItemParticipants: [lip('i1', 'u1'), lip('i2', 'u2')],
        participants: [makeParticipant('u1'), makeParticipant('u2')],
      }),
    );
    expect(owedOf(result, 'u1')).toBe(60);
    expect(owedOf(result, 'u2')).toBe(40);
  });

  it('16. single-participant bill owes the full total', () => {
    const result = computeSplit(
      input({
        expense: { totalAmount: 50 },
        lineItems: [makeItem({ id: 'i1', name: 'Solo', totalPrice: 50 })],
        lineItemParticipants: [lip('i1', 'u1')],
        participants: [makeParticipant('u1')],
      }),
    );
    expect(owedOf(result, 'u1')).toBe(50);
    expect(result.byUser).toHaveLength(1);
  });

  it('17. participant with isIncluded=false is excluded from results', () => {
    const result = computeSplit(
      input({
        expense: { totalAmount: 100, splitMethod: 'equal' },
        splitRule: makeRule('equal'),
        participants: [
          makeParticipant('u1'),
          makeParticipant('u2'),
          makeParticipant('u3', { isIncluded: false }),
        ],
      }),
    );
    expect(result.byUser).toHaveLength(2);
    expect(result.byUser.map((u) => u.userId).sort()).toEqual(['u1', 'u2']);
    expect(owedOf(result, 'u1')).toBe(50);
    expect(owedOf(result, 'u2')).toBe(50);
  });

  it('18. rounding leftover penny is assigned deterministically', () => {
    // 3 users equal split of $10. Raw share = 3.3333... each.
    // Rounded to 3.33 each, sum = 9.99. Leftover $0.01 -> highest-abs-value,
    // tie-broken lex (u1 wins). u1 = 3.34, u2 = u3 = 3.33.
    const result = computeSplit(
      input({
        expense: { totalAmount: 10, splitMethod: 'equal' },
        splitRule: makeRule('equal'),
        participants: [makeParticipant('u1'), makeParticipant('u2'), makeParticipant('u3')],
      }),
    );
    expect(sumOwed(result)).toBe(10);
    expect(owedOf(result, 'u1')).toBe(3.34);
    expect(owedOf(result, 'u2')).toBe(3.33);
    expect(owedOf(result, 'u3')).toBe(3.33);
  });

  it('19. sum of user totals exactly equals expense.totalAmount for any realistic bill', () => {
    // Complex bill: 3 users, mixed items, discount, tax, fees -- the sum
    // of all user.totalOwed must equal expense.totalAmount to the cent.
    const result = computeSplit(
      input({
        expense: { totalAmount: 100 },
        lineItems: [
          makeItem({ id: 'i1', name: 'A', totalPrice: 33.33 }),
          makeItem({ id: 'i2', name: 'B', totalPrice: 33.33 }),
          makeItem({ id: 'i3', name: 'C', totalPrice: 33.34 }),
        ],
        lineItemParticipants: [lip('i1', 'u1'), lip('i2', 'u2'), lip('i3', 'u3')],
        chargeComponents: [
          makeCharge({ id: 'd', type: 'discount', label: 'Promo', amount: 7, allocationRule: 'equal_per_person', position: 0 }),
          makeCharge({ id: 'tax', type: 'tax', label: 'Tax', amount: 4, allocationRule: 'proportional_subtotal', position: 1 }),
          makeCharge({ id: 'tip', type: 'tip', label: 'Tip', amount: 3, allocationRule: 'proportional_subtotal', position: 2 }),
        ],
        participants: [makeParticipant('u1'), makeParticipant('u2'), makeParticipant('u3')],
      }),
    );
    expect(sumOwed(result)).toBe(100);
  });

  it('20. every user has a non-empty, well-typed breakdown', () => {
    const result = computeSplit(
      input({
        expense: { totalAmount: 50 },
        lineItems: [makeItem({ id: 'i1', name: 'Combo', totalPrice: 40 })],
        lineItemParticipants: [lip('i1', 'u1'), lip('i1', 'u2')],
        chargeComponents: [makeCharge({ id: 't', type: 'tax', label: 'Tax', amount: 10 })],
        participants: [makeParticipant('u1'), makeParticipant('u2')],
      }),
    );
    for (const u of result.byUser) {
      expect(u.entries.length).toBeGreaterThan(0);
      for (const e of u.entries) {
        expect(['item', 'charge', 'tax', 'discount', 'subtotal']).toContain(e.type);
        expect(typeof e.description).toBe('string');
        expect(typeof e.amount).toBe('number');
      }
    }
  });

  it('21. excluded_user_ids on a charge skips that user for that charge only', () => {
    // 3 users equal item share. Tax with u3 excluded.
    // Items: $30 split equally -> $10 each.
    // Tax $6 proportional_subtotal but u3 excluded -> u1 and u2 split $6 by subtotal -> $3 each.
    // Final: u1 = 13, u2 = 13, u3 = 10. Total = 36.
    const result = computeSplit(
      input({
        expense: { totalAmount: 36 },
        lineItems: [makeItem({ id: 'i1', name: 'Shared', totalPrice: 30 })],
        lineItemParticipants: [lip('i1', 'u1'), lip('i1', 'u2'), lip('i1', 'u3')],
        chargeComponents: [
          makeCharge({ id: 't', type: 'tax', label: 'Tax', amount: 6, excludedUserIds: ['u3'] }),
        ],
        participants: [makeParticipant('u1'), makeParticipant('u2'), makeParticipant('u3')],
      }),
    );
    expect(owedOf(result, 'u1')).toBe(13);
    expect(owedOf(result, 'u2')).toBe(13);
    expect(owedOf(result, 'u3')).toBe(10);
  });

  it('22. unclaimed line item defaults to equal split across included participants', () => {
    // Item $30 with no claimants -> split equally among included.
    // 3 users -> $10 each.
    const result = computeSplit(
      input({
        expense: { totalAmount: 30 },
        lineItems: [makeItem({ id: 'i1', name: 'Mystery', totalPrice: 30 })],
        lineItemParticipants: [],
        participants: [makeParticipant('u1'), makeParticipant('u2'), makeParticipant('u3')],
      }),
    );
    expect(owedOf(result, 'u1')).toBe(10);
    expect(owedOf(result, 'u2')).toBe(10);
    expect(owedOf(result, 'u3')).toBe(10);
  });
});
