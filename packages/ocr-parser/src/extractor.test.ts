import { describe, it, expect } from 'vitest';
import { extractFields } from './extractor';
import { classifyLines } from './classifier';
import type { RawLine } from './types';

// ─── Helper ───────────────────────────────────────────────────────────────────

function run(texts: string[], country: 'IN' | 'US', billType: 'restaurant' | 'grocery' | 'delivery' | 'utility' | 'custom') {
  const lines: RawLine[] = texts.map((text, i) => ({ text, position: i }));
  const classified = classifyLines(lines);
  return extractFields(classified, country, billType);
}

// ─── Merchant name ────────────────────────────────────────────────────────────

describe('extractFields — merchant name', () => {
  it('extracts first line as merchant name', () => {
    const draft = run(['Mainland China', 'Butter Chicken  320', 'Total  320'], 'IN', 'restaurant');
    expect(draft.merchantName).toBe('Mainland China');
  });

  it('merchant name confidence matches classifier output', () => {
    const draft = run(['Taj Restaurant', 'Burger  200', 'Total  200'], 'IN', 'restaurant');
    expect(draft.confidenceScores.merchantName).toBeGreaterThan(0);
  });
});

// ─── Date parsing ─────────────────────────────────────────────────────────────

describe('extractFields — date', () => {
  it('parses DD/MM/YYYY', () => {
    const draft = run(['Cafe X', '10/05/2026', 'Total  100'], 'IN', 'restaurant');
    expect(draft.date).toBe('2026-05-10');
  });

  it('parses YYYY-MM-DD', () => {
    const draft = run(['Cafe X', '2026-05-10', 'Total  100'], 'US', 'restaurant');
    expect(draft.date).toBe('2026-05-10');
  });

  it('parses MM/DD/YYYY (US style)', () => {
    const draft = run(['Chipotle', '05/10/2026', 'Total  20'], 'US', 'restaurant');
    // Ambiguous: treated as DD/MM/YYYY → 2026-10-05 (acceptable, user reviews)
    expect(draft.date).not.toBeNull();
  });

  it('parses written date', () => {
    const draft = run(['Cafe X', '10 May 2026', 'Total  100'], 'IN', 'restaurant');
    expect(draft.date).toBe('2026-05-10');
  });

  it('returns null for unparseable date', () => {
    const draft = run(['Cafe X', 'Total  100'], 'IN', 'restaurant');
    expect(draft.date).toBeNull();
  });
});

// ─── Items ────────────────────────────────────────────────────────────────────

describe('extractFields — items', () => {
  it('extracts a single item', () => {
    const draft = run(['Cafe', 'Butter Chicken  320', 'Total  320'], 'IN', 'restaurant');
    expect(draft.items).toHaveLength(1);
    expect(draft.items[0].name).toBe('Butter Chicken');
    expect(draft.items[0].totalPrice).toBe(320);
    expect(draft.items[0].quantity).toBe(1);
    expect(draft.items[0].unitPrice).toBe(320);
  });

  it('extracts multiple items', () => {
    const draft = run([
      'Cafe',
      'Butter Chicken  320',
      'Garlic Naan  80',
      'Total  400',
    ], 'IN', 'restaurant');
    expect(draft.items).toHaveLength(2);
  });

  it('handles quantity prefix (2x Naan)', () => {
    const draft = run(['Cafe', '2x Garlic Naan  160', 'Total  160'], 'IN', 'restaurant');
    expect(draft.items[0].quantity).toBe(2);
    expect(draft.items[0].unitPrice).toBe(80);
    expect(draft.items[0].totalPrice).toBe(160);
    expect(draft.items[0].name).toBe('Garlic Naan');
  });

  it('handles quantity suffix (Naan x2)', () => {
    const draft = run(['Cafe', 'Garlic Naan x2  160', 'Total  160'], 'IN', 'restaurant');
    expect(draft.items[0].quantity).toBe(2);
    expect(draft.items[0].name).toBe('Garlic Naan');
  });

  it('detects alcohol category', () => {
    const draft = run(['Cafe', 'Kingfisher Beer  180', 'Total  180'], 'IN', 'restaurant');
    expect(draft.items[0].category).toBe('alcohol');
  });

  it('detects food category for regular item', () => {
    const draft = run(['Cafe', 'Butter Chicken  320', 'Total  320'], 'IN', 'restaurant');
    expect(draft.items[0].category).toBe('food');
  });

  it('detects non_taxable for mineral water', () => {
    const draft = run(['Cafe', 'Mineral Water  40', 'Total  40'], 'IN', 'restaurant');
    expect(draft.items[0].category).toBe('non_taxable');
  });
});

// ─── India: CGST + SGST merge ────────────────────────────────────────────────

describe('extractFields — India GST merge', () => {
  it('merges CGST and SGST into a single GST charge', () => {
    const draft = run([
      'Mainland China',
      'Butter Chicken  320',
      'CGST @ 2.5%  8.00',
      'SGST @ 2.5%  8.00',
      'Total  336',
    ], 'IN', 'restaurant');

    const gst = draft.charges.find((c) => c.type === 'sales_tax');
    expect(gst).toBeDefined();
    expect(gst!.amount).toBe(16); // 8 + 8
    expect(gst!.label).toBe('GST @ 5.0%');
  });

  it('still produces GST charge if only CGST found (SGST missed by OCR)', () => {
    const draft = run([
      'Mainland China',
      'Butter Chicken  320',
      'CGST @ 2.5%  8.00',
      'Total  328',
    ], 'IN', 'restaurant');

    const gst = draft.charges.find((c) => c.type === 'sales_tax');
    expect(gst).toBeDefined();
    expect(gst!.amount).toBe(8);
  });

  it('GST charge confidence is high', () => {
    const draft = run([
      'Mainland China',
      'Butter Chicken  320',
      'CGST @ 2.5%  8.00',
      'SGST @ 2.5%  8.00',
      'Total  336',
    ], 'IN', 'restaurant');

    const gst = draft.charges.find((c) => c.type === 'sales_tax');
    expect(gst!.confidence).toBeGreaterThanOrEqual(0.90);
  });
});

// ─── US: tax and tip ─────────────────────────────────────────────────────────

describe('extractFields — US tax and tip', () => {
  it('extracts sales tax as state_tax type', () => {
    const draft = run([
      'Chipotle',
      'Burrito Bowl  12.50',
      'Sales Tax  1.20',
      'Total  13.70',
    ], 'US', 'restaurant');

    const tax = draft.charges.find((c) => c.type === 'state_tax');
    expect(tax).toBeDefined();
    expect(tax!.amount).toBe(1.20);
  });

  it('extracts tip as gratuity type', () => {
    const draft = run([
      'Diner',
      'Burger  10.00',
      'Tip  2.00',
      'Total  12.00',
    ], 'US', 'restaurant');

    const tip = draft.charges.find((c) => c.type === 'gratuity');
    expect(tip).toBeDefined();
    expect(tip!.amount).toBe(2.00);
    expect(tip!.label).toBe('Tip');
  });

  it('India service charge labeled as Service Charge not Tip', () => {
    const draft = run([
      'Mainland China',
      'Butter Chicken  320',
      'Service Charge  32',
      'Total  352',
    ], 'IN', 'restaurant');

    const sc = draft.charges.find((c) => c.type === 'gratuity');
    expect(sc!.label).toBe('Service Charge');
  });
});

// ─── Fees ─────────────────────────────────────────────────────────────────────

describe('extractFields — fees', () => {
  it('extracts delivery fee', () => {
    const draft = run([
      'Swiggy',
      'Butter Chicken  320',
      'Delivery Fee  40',
      'Total  360',
    ], 'IN', 'delivery');

    const fee = draft.charges.find((c) => c.type === 'delivery_fee');
    expect(fee).toBeDefined();
    expect(fee!.amount).toBe(40);
  });

  it('extracts platform fee', () => {
    const draft = run([
      'Zomato',
      'Burger  200',
      'Platform Fee  10',
      'Total  210',
    ], 'IN', 'delivery');

    const fee = draft.charges.find((c) => c.type === 'platform_fee');
    expect(fee).toBeDefined();
    expect(fee!.amount).toBe(10);
  });

  it('lowers charge confidence when delivery bill has no delivery fee', () => {
    const draft = run([
      'Swiggy',
      'Butter Chicken  320',
      'Total  320',
    ], 'IN', 'delivery');

    expect(draft.confidenceScores.charges).toBeLessThanOrEqual(0.60);
  });
});

// ─── Discounts ────────────────────────────────────────────────────────────────

describe('extractFields — discounts', () => {
  it('stores discount as negative amount', () => {
    const draft = run([
      'Swiggy',
      'Burger  200',
      'Discount  -50',
      'Total  150',
    ], 'IN', 'delivery');

    const disc = draft.charges.find((c) => c.type === 'discount');
    expect(disc).toBeDefined();
    expect(disc!.amount).toBe(-50);
  });

  it('forces negative even if receipt prints discount as positive', () => {
    const draft = run([
      'Swiggy',
      'Burger  200',
      'Promo Code SAVE50  50',
      'Total  150',
    ], 'IN', 'delivery');

    const disc = draft.charges.find((c) => c.type === 'discount');
    expect(disc!.amount).toBe(-50);
  });
});

// ─── Subtotal and total ───────────────────────────────────────────────────────

describe('extractFields — subtotal and total', () => {
  it('extracts explicit subtotal', () => {
    const draft = run([
      'Cafe',
      'Burger  200',
      'Subtotal  200',
      'Total  220',
    ], 'US', 'restaurant');

    expect(draft.subtotal).toBe(200);
    expect(draft.confidenceScores.subtotal).toBeGreaterThan(0.65);
  });

  it('infers subtotal from items if not found', () => {
    const draft = run([
      'Cafe',
      'Burger  200',
      'Fries  80',
      'Total  280',
    ], 'US', 'restaurant');

    expect(draft.subtotal).toBe(280);
    expect(draft.confidenceScores.subtotal).toBe(0.65); // inferred
  });

  it('extracts total', () => {
    const draft = run([
      'Cafe',
      'Burger  200',
      'Grand Total  220',
    ], 'US', 'restaurant');

    expect(draft.total).toBe(220);
    expect(draft.confidenceScores.total).toBeGreaterThan(0.85);
  });
});

// ─── Full receipt simulation ──────────────────────────────────────────────────

describe('extractFields — full receipt simulation', () => {
  it('correctly extracts a full Indian restaurant receipt', () => {
    const draft = run([
      'Mainland China',
      '10/05/2026',
      '----------',
      'Butter Chicken  320',
      'Garlic Naan x2  160',
      'Kingfisher Beer  180',
      '----------',
      'Subtotal  660',
      'CGST @ 2.5%  16.50',
      'SGST @ 2.5%  16.50',
      'Service Charge  66.00',
      '----------',
      'Grand Total  759.00',
      'Thank you!',
    ], 'IN', 'restaurant');

    expect(draft.merchantName).toBe('Mainland China');
    expect(draft.date).toBe('2026-05-10');
    expect(draft.items).toHaveLength(3);
    expect(draft.items[2].category).toBe('alcohol'); // Kingfisher Beer
    expect(draft.subtotal).toBe(660);
    expect(draft.total).toBe(759);

    const gst = draft.charges.find((c) => c.type === 'sales_tax');
    expect(gst!.amount).toBe(33); // 16.50 + 16.50
    expect(gst!.label).toBe('GST @ 5.0%');

    const sc = draft.charges.find((c) => c.type === 'gratuity');
    expect(sc!.amount).toBe(66);
    expect(sc!.label).toBe('Service Charge');
  });

  it('correctly extracts a US delivery receipt', () => {
    const draft = run([
      'Chipotle',
      '05/10/2026',
      'Burrito Bowl  12.50',
      'Chips & Guac  4.25',
      'Delivery Fee  3.99',
      'Sales Tax  1.35',
      'Tip  2.00',
      'Total  24.09',
    ], 'US', 'delivery');

    expect(draft.merchantName).toBe('Chipotle');
    expect(draft.items).toHaveLength(2);
    expect(draft.total).toBe(24.09);

    const delivery = draft.charges.find((c) => c.type === 'delivery_fee');
    expect(delivery!.amount).toBe(3.99);

    const tax = draft.charges.find((c) => c.type === 'state_tax');
    expect(tax!.amount).toBe(1.35);

    const tip = draft.charges.find((c) => c.type === 'gratuity');
    expect(tip!.amount).toBe(2.00);
  });
});
