import { describe, it, expect } from 'vitest';
import { derivePersonality } from '../src/personality';
import { makeBill } from './helpers';

describe('derivePersonality', () => {
  it('1. returns null with fewer than 5 bills', () => {
    const bills = Array.from({ length: 4 }, (_, i) => makeBill({ id: `b${i}` }));
    expect(derivePersonality(bills, 'u1')).toBeNull();
  });

  it('2. returns Splurger when user consistently above average', () => {
    const bills = Array.from({ length: 6 }, (_, i) =>
      makeBill({
        id: `b${i}`,
        participants: [
          { userId: 'u1', owedAmount: 80, paidAmount: 0 },
          { userId: 'u2', owedAmount: 20, paidAmount: 0 },
        ],
      }),
    );
    expect(derivePersonality(bills, 'u1')).toBe('Splurger');
  });

  it('3. returns Optimizer when user consistently below average', () => {
    const bills = Array.from({ length: 6 }, (_, i) =>
      makeBill({
        id: `b${i}`,
        participants: [
          { userId: 'u1', owedAmount: 20, paidAmount: 0 },
          { userId: 'u2', owedAmount: 80, paidAmount: 0 },
        ],
      }),
    );
    expect(derivePersonality(bills, 'u1')).toBe('Optimizer');
  });

  it('4. returns Even-Steven when close to average', () => {
    const bills = Array.from({ length: 6 }, (_, i) =>
      makeBill({
        id: `b${i}`,
        participants: [
          { userId: 'u1', owedAmount: 50, paidAmount: 0 },
          { userId: 'u2', owedAmount: 50, paidAmount: 0 },
        ],
      }),
    );
    expect(derivePersonality(bills, 'u1')).toBe('Even-Steven');
  });

  it('5. returns Settler when most bills settled fast', () => {
    const bills = Array.from({ length: 6 }, (_, i) =>
      makeBill({
        id: `b${i}`,
        date: `2026-05-0${i + 1}`,
        settledAt: `2026-05-0${i + 1}T06:00:00Z`, // 6 hours
        status: 'settled',
        participants: [
          { userId: 'u1', owedAmount: 50, paidAmount: 0 },
          { userId: 'u2', owedAmount: 50, paidAmount: 0 },
        ],
      }),
    );
    expect(derivePersonality(bills, 'u1')).toBe('Settler');
  });

  it('6. Settler takes priority over Even-Steven when settling fast', () => {
    const bills = Array.from({ length: 6 }, (_, i) =>
      makeBill({
        id: `b${i}`,
        date: `2026-05-0${i + 1}`,
        settledAt: `2026-05-0${i + 1}T02:00:00Z`,
        status: 'settled',
        participants: [
          { userId: 'u1', owedAmount: 50, paidAmount: 0 },
          { userId: 'u2', owedAmount: 50, paidAmount: 0 },
        ],
      }),
    );
    expect(derivePersonality(bills, 'u1')).toBe('Settler');
  });

  it('7. deterministic — same input always produces same output', () => {
    const bills = Array.from({ length: 6 }, (_, i) =>
      makeBill({
        id: `b${i}`,
        participants: [
          { userId: 'u1', owedAmount: 70, paidAmount: 0 },
          { userId: 'u2', owedAmount: 30, paidAmount: 0 },
        ],
      }),
    );
    const r1 = derivePersonality(bills, 'u1');
    const r2 = derivePersonality(bills, 'u1');
    expect(r1).toBe(r2);
  });
});
