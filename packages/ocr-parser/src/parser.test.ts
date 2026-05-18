import { describe, it, expect } from 'vitest';
import { parseReceipt } from './parser';
import type { RawLine } from './types';

function lines(texts: string[]): RawLine[] {
  return texts.map((text, i) => ({ text, position: i }));
}

describe('parseReceipt — confidence flagging', () => {
  it('flags no fields when all confidence is high', () => {
    const draft = parseReceipt({
      lines: lines([
        'Mainland China',
        '10/05/2026',
        'Butter Chicken  320',
        'CGST @ 2.5%  8.00',
        'SGST @ 2.5%  8.00',
        'Subtotal  320',
        'Grand Total  336',
      ]),
      country: 'IN',
      billType: 'restaurant',
    });

    expect(draft.flaggedFields).not.toContain('total');
    expect(draft.flaggedFields).not.toContain('items');
  });

  it('flags total when missing', () => {
    const draft = parseReceipt({
      lines: lines([
        'Mainland China',
        'Butter Chicken  320',
        // no total line
      ]),
      country: 'IN',
      billType: 'restaurant',
    });

    expect(draft.flaggedFields).toContain('total');
  });

  it('flags subtotal when inferred from items (confidence 0.65 < threshold 0.75)', () => {
    const draft = parseReceipt({
      lines: lines([
        'Cafe',
        'Burger  200',
        'Total  200',
        // no explicit subtotal line
      ]),
      country: 'US',
      billType: 'restaurant',
    });

    expect(draft.flaggedFields).toContain('subtotal');
  });

  it('flags charges for delivery bill with no delivery fee', () => {
    const draft = parseReceipt({
      lines: lines([
        'Swiggy',
        'Butter Chicken  320',
        'Total  320',
      ]),
      country: 'IN',
      billType: 'delivery',
    });

    expect(draft.flaggedFields).toContain('charges');
  });

  it('respects custom confidence threshold', () => {
    // All fields present so all confidence scores are non-zero.
    // With threshold 0.50, only inferred subtotal (0.65 > 0.50) won't be flagged.
    const draft = parseReceipt({
      lines: lines([
        'Mainland China',
        '10/05/2026',
        'Burger  200',
        'Sales Tax  1.20',
        'Subtotal  200',
        'Total  201.20',
      ]),
      country: 'US',
      billType: 'restaurant',
      confidenceThreshold: 0.50,
    });

    expect(draft.flaggedFields).toHaveLength(0);
  });

  it('full parse produces correct output shape', () => {
    const draft = parseReceipt({
      lines: lines([
        'Mainland China',
        '10/05/2026',
        'Butter Chicken  320',
        'Garlic Naan x2  160',
        'Kingfisher Beer  180',
        'Subtotal  660',
        'CGST @ 2.5%  16.50',
        'SGST @ 2.5%  16.50',
        'Service Charge  66.00',
        'Grand Total  759.00',
      ]),
      country: 'IN',
      billType: 'restaurant',
    });

    expect(draft.country).toBe('IN');
    expect(draft.billType).toBe('restaurant');
    expect(draft.merchantName).toBe('Mainland China');
    expect(draft.date).toBe('2026-05-10');
    expect(draft.items).toHaveLength(3);
    expect(draft.total).toBe(759);
    expect(draft.charges.find((c) => c.type === 'sales_tax')?.amount).toBe(33);
    expect(Array.isArray(draft.flaggedFields)).toBe(true);
  });
});
