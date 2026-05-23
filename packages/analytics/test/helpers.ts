import type { BillRecord } from '../src/types';

export function makeBill(overrides: Partial<BillRecord> & { id: string }): BillRecord {
  return {
    date: '2026-05-01',
    title: 'Test Bill',
    billType: 'restaurant',
    totalAmount: 100,
    currency: 'USD',
    status: 'active',
    settledAt: null,
    participants: [
      { userId: 'u1', owedAmount: 50, paidAmount: 100 },
      { userId: 'u2', owedAmount: 50, paidAmount: 0 },
    ],
    items: [{ name: 'Item', totalPrice: 100, category: 'food' }],
    ...overrides,
  };
}
