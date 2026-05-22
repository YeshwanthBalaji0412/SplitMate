import { describe, it, expect } from 'vitest';
import type { RawLine } from '@splitmate/types';
import { parseReceipt } from '../src/parser';

function lines(texts: string[]): RawLine[] {
  return texts.map((text, i) => ({ text, position: i }));
}

describe('parser (parseReceipt)', () => {
  it('1. parses a valid US restaurant receipt', () => {
    const result = parseReceipt({
      lines: lines([
        'THE GOLDEN OAK', '03/15/2026',
        'Grilled Salmon $24.00', 'Caesar Salad $14.50',
        'Subtotal $38.50', 'Sales Tax $3.18', 'Tip $7.00', 'Total $48.68',
      ]),
      country: 'US',
      billType: 'restaurant',
    });
    expect(result.merchant.name).toBe('THE GOLDEN OAK');
    expect(result.date).toBe('2026-03-15');
    expect(result.currency).toBe('USD');
    expect(result.items).toHaveLength(2);
    expect(result.total).toBeCloseTo(48.68, 1);
  });

  it('2. parses a valid US grocery receipt', () => {
    const result = parseReceipt({
      lines: lines([
        'WHOLE FOODS', '05/20/2026',
        'Organic Bananas $1.99', 'Chardonnay 750ml $12.99',
        'Subtotal $14.98', 'Sales Tax $1.07', 'Total $16.05',
      ]),
      country: 'US',
      billType: 'grocery',
    });
    expect(result.items).toHaveLength(2);
    expect(result.items.find((i) => i.name.includes('Chardonnay'))!.category).toBe('alcohol');
  });

  it('3. parses a valid US delivery receipt with discount', () => {
    const result = parseReceipt({
      lines: lines([
        'DoorDash', 'May 18, 2026',
        'Chicken Tikka $16.99', 'Naan $3.49',
        'Subtotal $20.48', 'Delivery Fee $3.99', 'Discount -$3.00',
        'Tax $1.69', 'Total $23.16',
      ]),
      country: 'US',
      billType: 'delivery',
    });
    const disc = result.charges.find((c) => c.type === 'discount');
    expect(disc).toBeDefined();
    expect(disc!.amount).toBeLessThan(0);
  });

  it('4. parses a valid Indian restaurant receipt with CGST+SGST', () => {
    const result = parseReceipt({
      lines: lines([
        'PUNJAB GRILL', '15/03/2026',
        'Butter Chicken ₹520', 'Naan ₹80',
        'Subtotal ₹600', 'CGST @ 2.5% ₹15', 'SGST @ 2.5% ₹15',
        'Grand Total ₹630',
      ]),
      country: 'IN',
      billType: 'restaurant',
    });
    expect(result.currency).toBe('INR');
    const taxes = result.charges.filter((c) => c.type === 'tax');
    expect(taxes).toHaveLength(1);
    expect(taxes[0]!.label).toBe('GST');
    expect(taxes[0]!.amount).toBe(30);
  });

  it('5. parses a valid Indian delivery receipt', () => {
    const result = parseReceipt({
      lines: lines([
        'Zomato', '22/05/2026',
        'Paneer Masala ₹289', 'Naan ₹118',
        'Subtotal ₹407', 'Delivery Fee ₹40', 'GST ₹20.35',
        'Coupon Discount -₹50', 'Grand Total ₹417.35',
      ]),
      country: 'IN',
      billType: 'delivery',
    });
    expect(result.items).toHaveLength(2);
    expect(result.charges.some((c) => c.type === 'delivery')).toBe(true);
    expect(result.charges.some((c) => c.type === 'discount')).toBe(true);
  });

  it('6. flags missing total', () => {
    const result = parseReceipt({
      lines: lines(['Shop', 'Item $10.00']),
      country: 'US',
      billType: 'restaurant',
    });
    expect(result.flaggedFields).toContain('total');
  });

  it('7. handles noisy OCR gracefully', () => {
    const result = parseReceipt({
      lines: lines([
        'x#@!$z9', '... .... ...', 'rndm txt 42',
        '-----', 'Thank you', '',
      ]),
      country: 'US',
      billType: 'restaurant',
    });
    expect(result.flaggedFields.length).toBeGreaterThan(0);
    expect(result.rawText).toBeTruthy();
  });

  it('8. returns safe empty draft on zero input', () => {
    const result = parseReceipt({ lines: [], country: 'US', billType: 'restaurant' });
    expect(result.items).toHaveLength(0);
    expect(result.charges).toHaveLength(0);
    expect(result.flaggedFields).toContain('merchant.name');
    expect(result.flaggedFields).toContain('date');
    expect(result.flaggedFields).toContain('total');
  });

  it('9. sets confidence scores for all fields', () => {
    const result = parseReceipt({
      lines: lines([
        'Shop', '01/01/2026', 'Burger $10.00', 'Subtotal $10.00',
        'Tax $0.80', 'Total $10.80',
      ]),
      country: 'US',
      billType: 'restaurant',
    });
    expect(result.confidenceScores['total']).toBeGreaterThan(0);
    expect(result.confidenceScores['merchant.name']).toBeDefined();
    expect(result.confidenceScores['date']).toBeDefined();
  });

  it('10. flags fields below confidence threshold', () => {
    // Noisy receipt where items have low confidence
    const result = parseReceipt({
      lines: lines(['???', 'abc 1.23', 'Total 1.23']),
      country: 'US',
      billType: 'restaurant',
    });
    expect(result.flaggedFields.length).toBeGreaterThan(0);
  });

  it('11. never throws on any input', () => {
    // Completely garbage input — should not throw
    const garbageLines = Array.from({ length: 50 }, (_, i) => ({
      text: String.fromCharCode(33 + (i * 7) % 94).repeat(i + 1),
      position: i,
    }));
    expect(() =>
      parseReceipt({ lines: garbageLines, country: 'US', billType: 'custom' }),
    ).not.toThrow();
    expect(() =>
      parseReceipt({ lines: garbageLines, country: 'IN', billType: 'delivery' }),
    ).not.toThrow();
  });

  it('12. rawText always populated', () => {
    const result = parseReceipt({
      lines: lines(['Hello', 'World']),
      country: 'US',
      billType: 'restaurant',
    });
    expect(result.rawText).toBe('Hello\nWorld');
  });
});
