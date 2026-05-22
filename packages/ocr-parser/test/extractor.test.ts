import { describe, it, expect } from 'vitest';
import type { RawLine } from '@splitmate/types';
import { classifyLines } from '../src/classifier';
import { extractFields } from '../src/extractor';

function extract(texts: string[], country: 'US' | 'IN' = 'US', billType = 'restaurant' as const) {
  const lines: RawLine[] = texts.map((text, i) => ({ text, position: i }));
  const classified = classifyLines(lines, country);
  return extractFields(classified, country, billType);
}

describe('extractor', () => {
  // --- Merchant ---
  it('1. extracts merchant name from top line', () => {
    const result = extract(['THE GOLDEN OAK', 'Salmon $24.00', 'Total $24.00']);
    expect(result.merchant).toBe('THE GOLDEN OAK');
  });

  // --- Date ---
  it('2. extracts US date (MM/DD/YYYY)', () => {
    const result = extract(['Restaurant', '03/15/2026', 'Item $10.00', 'Total $10.00']);
    expect(result.date).toBe('2026-03-15');
  });
  it('3. extracts Indian date (DD/MM/YYYY)', () => {
    const result = extract(['Restaurant', '15/03/2026', 'Item ₹100', 'Total ₹100'], 'IN');
    expect(result.date).toBe('2026-03-15');
  });
  it('4. extracts named-month date', () => {
    const result = extract(['Shop', 'May 18, 2026', 'Item $5.00', 'Total $5.00']);
    expect(result.date).toBe('2026-05-18');
  });

  // --- Items ---
  it('5. extracts US dollar item', () => {
    const result = extract(['Shop', 'Grilled Salmon $24.00', 'Total $24.00']);
    expect(result.items).toHaveLength(1);
    expect(result.items[0]!.name).toBe('Grilled Salmon');
    expect(result.items[0]!.totalPrice).toBe(24);
  });
  it('6. extracts item with quantity prefix', () => {
    const result = extract(['Shop', '2x Garlic Bread $9.00', 'Total $9.00']);
    expect(result.items[0]!.quantity).toBe(2);
    expect(result.items[0]!.unitPrice).toBe(4.5);
  });
  it('7. extracts INR item', () => {
    const result = extract(['Shop', 'Butter Chicken ₹520', 'Total ₹520'], 'IN');
    expect(result.items[0]!.totalPrice).toBe(520);
    expect(result.items[0]!.category).toBe('food');
  });

  // --- Subtotal / Total ---
  it('8. extracts subtotal and total', () => {
    const result = extract([
      'Shop', 'Item $10.00', 'Subtotal $10.00', 'Tax $0.80', 'Total $10.80',
    ]);
    expect(result.subtotal).toBe(10);
    expect(result.total).toBe(10.8);
  });

  // --- Tax ---
  it('9. extracts US sales tax', () => {
    const result = extract(['Shop', 'Item $10.00', 'Sales Tax $0.83', 'Total $10.83']);
    expect(result.charges.some((c) => c.type === 'tax' && c.amount === 0.83)).toBe(true);
  });

  // --- CGST/SGST aggregation ---
  it('10. aggregates CGST+SGST into single GST (India)', () => {
    const result = extract([
      'Shop', 'Item ₹1000', 'CGST @ 2.5% ₹25', 'SGST @ 2.5% ₹25', 'Total ₹1050',
    ], 'IN');
    const taxes = result.charges.filter((c) => c.type === 'tax');
    expect(taxes).toHaveLength(1);
    expect(taxes[0]!.label).toBe('GST');
    expect(taxes[0]!.amount).toBe(50);
  });

  // --- Discount ---
  it('11. extracts discount as negative amount', () => {
    const result = extract(['Shop', 'Item $20.00', 'Discount -$3.00', 'Total $17.00']);
    const disc = result.charges.find((c) => c.type === 'discount');
    expect(disc).toBeDefined();
    expect(disc!.amount).toBeLessThan(0);
  });

  // --- Delivery / platform fees ---
  it('12. extracts delivery fee', () => {
    const result = extract(['Shop', 'Item $10.00', 'Delivery Fee $3.99', 'Total $13.99']);
    expect(result.charges.some((c) => c.type === 'delivery' && c.amount === 3.99)).toBe(true);
  });
  it('13. extracts platform fee (India)', () => {
    const result = extract(['Shop', 'Item ₹100', 'Platform Fee ₹7', 'Total ₹107'], 'IN');
    expect(result.charges.some((c) => c.type === 'platform' && c.amount === 7)).toBe(true);
  });

  // --- Currency ---
  it('14. sets currency to USD for US', () => {
    const result = extract(['Shop', 'Item $10', 'Total $10']);
    expect(result.currency).toBe('USD');
  });
  it('15. sets currency to INR for India', () => {
    const result = extract(['Shop', 'Item ₹100', 'Total ₹100'], 'IN');
    expect(result.currency).toBe('INR');
  });

  // --- Item categorization ---
  it('16. categorizes beer as alcohol', () => {
    const result = extract(['Shop', 'IPA Draft Beer $8.00', 'Total $8.00']);
    expect(result.items[0]!.category).toBe('alcohol');
  });
  it('17. categorizes bottled water as non_taxable', () => {
    const result = extract(['Shop', 'Bottled Water $3.50', 'Total $3.50']);
    expect(result.items[0]!.category).toBe('non_taxable');
  });
  it('18. categorizes normal food as food', () => {
    const result = extract(['Shop', 'Caesar Salad $14.50', 'Total $14.50']);
    expect(result.items[0]!.category).toBe('food');
  });

  // --- Service charge ---
  it('19. extracts service charge (India)', () => {
    const result = extract([
      'Shop', 'Item ₹100', 'Service Charge 10% ₹10', 'Total ₹110',
    ], 'IN');
    expect(result.charges.some((c) => c.type === 'service')).toBe(true);
  });

  // --- Tip ---
  it('20. extracts tip (US)', () => {
    const result = extract(['Shop', 'Item $10', 'Tip $2.00', 'Total $12.00']);
    expect(result.charges.some((c) => c.type === 'tip' && c.amount === 2)).toBe(true);
  });
});
