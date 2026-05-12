import { describe, it, expect } from 'vitest';
import { classifyLines, extractPrice } from './classifier';
import type { RawLine } from './types';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function lines(texts: string[]): RawLine[] {
  return texts.map((text, i) => ({ text, position: i }));
}

function classifyFirst(texts: string[]) {
  return classifyLines(lines(texts));
}

// ─── extractPrice ─────────────────────────────────────────────────────────────

describe('extractPrice', () => {
  it('extracts plain number', () => {
    expect(extractPrice('Butter Chicken 320')).toBe(320);
  });

  it('extracts with ₹ symbol', () => {
    expect(extractPrice('Butter Chicken ₹320')).toBe(320);
  });

  it('extracts with $ symbol', () => {
    expect(extractPrice('Burger $12.50')).toBe(12.5);
  });

  it('extracts decimal price', () => {
    expect(extractPrice('CGST @ 2.5%  18.00')).toBe(18.0);
  });

  it('extracts price with comma as thousands separator', () => {
    expect(extractPrice('Total 1,200')).toBe(1200);
  });

  it('returns null when no price present', () => {
    expect(extractPrice('Thank you for visiting!')).toBeNull();
  });

  it('returns null for empty string', () => {
    expect(extractPrice('')).toBeNull();
  });
});

// ─── classifyLines — noise ────────────────────────────────────────────────────

describe('classifyLines — noise', () => {
  it('classifies empty line as noise', () => {
    const result = classifyLines(lines(['']));
    expect(result[0].lineType).toBe('noise');
  });

  it('classifies separator line as noise', () => {
    const result = classifyLines(lines(['Mainland China', '----------']));
    expect(result[1].lineType).toBe('noise');
  });

  it('classifies thank you line as noise', () => {
    const result = classifyLines(lines(['Mainland China', 'Thank you for visiting!']));
    expect(result[1].lineType).toBe('noise');
  });

  it('classifies GSTIN registration line as noise', () => {
    const result = classifyLines(lines(['Mainland China', 'GSTIN: 27AABCU9603R1ZX']));
    expect(result[1].lineType).toBe('noise');
  });
});

// ─── classifyLines — merchant_name ───────────────────────────────────────────

describe('classifyLines — merchant_name', () => {
  it('classifies first non-empty line as merchant name', () => {
    const result = classifyFirst(['Mainland China', 'Date: 10/05/2026', 'Butter Chicken 320']);
    expect(result[0].lineType).toBe('merchant_name');
  });

  it('merchant name confidence is at least 0.75', () => {
    const result = classifyFirst(['Taj Restaurant', 'Burger 200']);
    expect(result[0].confidence).toBeGreaterThanOrEqual(0.75);
  });
});

// ─── classifyLines — date ────────────────────────────────────────────────────

describe('classifyLines — date', () => {
  it('classifies DD/MM/YYYY format', () => {
    const result = classifyFirst(['Mainland China', '10/05/2026']);
    expect(result[1].lineType).toBe('date');
  });

  it('classifies YYYY-MM-DD format', () => {
    const result = classifyFirst(['Cafe X', '2026-05-10']);
    expect(result[1].lineType).toBe('date');
  });

  it('classifies written date format', () => {
    const result = classifyFirst(['Cafe X', '10 May 2026']);
    expect(result[1].lineType).toBe('date');
  });
});

// ─── classifyLines — tax_line ─────────────────────────────────────────────────

describe('classifyLines — tax_line (India)', () => {
  it('classifies CGST line', () => {
    const result = classifyFirst(['Cafe X', 'CGST @ 2.5%  18.00']);
    expect(result[1].lineType).toBe('tax_line');
  });

  it('classifies SGST line', () => {
    const result = classifyFirst(['Cafe X', 'SGST @ 2.5%  18.00']);
    expect(result[1].lineType).toBe('tax_line');
  });

  it('classifies GST line', () => {
    const result = classifyFirst(['Cafe X', 'GST  36.00']);
    expect(result[1].lineType).toBe('tax_line');
  });

  it('tax_line confidence is high (>=0.90)', () => {
    const result = classifyFirst(['Cafe X', 'CGST @ 2.5%  18.00']);
    expect(result[1].confidence).toBeGreaterThanOrEqual(0.90);
  });
});

describe('classifyLines — tax_line (US)', () => {
  it('classifies Sales Tax line', () => {
    const result = classifyFirst(['Chipotle', 'Sales Tax  1.20']);
    expect(result[1].lineType).toBe('tax_line');
  });

  it('classifies State Tax line', () => {
    const result = classifyFirst(['Chipotle', 'State Tax  0.80']);
    expect(result[1].lineType).toBe('tax_line');
  });
});

// ─── classifyLines — fee_line ─────────────────────────────────────────────────

describe('classifyLines — fee_line', () => {
  it('classifies delivery fee', () => {
    const result = classifyFirst(['Swiggy', 'Delivery Fee  40.00']);
    expect(result[1].lineType).toBe('fee_line');
  });

  it('classifies platform fee', () => {
    const result = classifyFirst(['Swiggy', 'Platform Fee  10.00']);
    expect(result[1].lineType).toBe('fee_line');
  });

  it('classifies packing charges', () => {
    const result = classifyFirst(['Zomato', 'Packing Charges  15.00']);
    expect(result[1].lineType).toBe('fee_line');
  });

  it('classifies convenience fee', () => {
    const result = classifyFirst(['UberEats', 'Convenience Fee  2.99']);
    expect(result[1].lineType).toBe('fee_line');
  });
});

// ─── classifyLines — tip ──────────────────────────────────────────────────────

describe('classifyLines — tip', () => {
  it('classifies Tip line (US)', () => {
    const result = classifyFirst(['Diner', 'Tip  5.00']);
    expect(result[1].lineType).toBe('tip');
  });

  it('classifies Gratuity line', () => {
    const result = classifyFirst(['Diner', 'Gratuity (18%)  7.20']);
    expect(result[1].lineType).toBe('tip');
  });

  it('classifies Service Charge (India) as tip', () => {
    const result = classifyFirst(['Mainland China', 'Service Charge  120.00']);
    expect(result[1].lineType).toBe('tip');
  });
});

// ─── classifyLines — discount ────────────────────────────────────────────────

describe('classifyLines — discount', () => {
  it('classifies Discount line', () => {
    const result = classifyFirst(['Swiggy', 'Discount  -50.00']);
    expect(result[1].lineType).toBe('discount');
  });

  it('classifies Promo line', () => {
    const result = classifyFirst(['Zomato', 'Promo Code SAVE50  -30.00']);
    expect(result[1].lineType).toBe('discount');
  });

  it('classifies negative currency amount as discount', () => {
    const result = classifyFirst(['App', 'SomeOffer -₹25']);
    expect(result[1].lineType).toBe('discount');
  });
});

// ─── classifyLines — subtotal / total ────────────────────────────────────────

describe('classifyLines — subtotal and total', () => {
  it('classifies Subtotal line', () => {
    const result = classifyFirst(['Cafe X', 'Subtotal  500.00']);
    expect(result[1].lineType).toBe('subtotal');
  });

  it('classifies Total line', () => {
    const result = classifyFirst(['Cafe X', 'Total  572.00']);
    expect(result[1].lineType).toBe('total');
  });

  it('classifies Grand Total line', () => {
    const result = classifyFirst(['Cafe X', 'Grand Total  572.00']);
    expect(result[1].lineType).toBe('total');
  });

  it('Total takes priority over Subtotal when both words present', () => {
    // "Total" pattern checked before "Subtotal" in classifier
    const result = classifyFirst(['Cafe X', 'Total Amount Due  572.00']);
    expect(result[1].lineType).toBe('total');
  });
});

// ─── classifyLines — item ────────────────────────────────────────────────────

describe('classifyLines — item', () => {
  it('classifies item line with ₹ price', () => {
    const result = classifyFirst(['Cafe X', 'Butter Chicken  ₹320']);
    expect(result[1].lineType).toBe('item');
  });

  it('classifies item line with plain number price at end', () => {
    const result = classifyFirst(['Cafe X', 'Garlic Naan  80']);
    expect(result[1].lineType).toBe('item');
  });

  it('classifies quantity × price format as item', () => {
    const result = classifyFirst(['Cafe X', 'Naan x2  160']);
    expect(result[1].lineType).toBe('item');
  });
});

// ─── classifyLines — full receipt simulation ─────────────────────────────────

describe('classifyLines — full receipt', () => {
  it('correctly classifies a typical Indian restaurant receipt', () => {
    const receipt = [
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
    ];

    const result = classifyFirst(receipt);
    const types = result.map((r) => r.lineType);

    expect(types[0]).toBe('merchant_name');
    expect(types[1]).toBe('date');
    expect(types[2]).toBe('noise');
    expect(types[3]).toBe('item');   // Butter Chicken
    expect(types[4]).toBe('item');   // Garlic Naan
    expect(types[5]).toBe('item');   // Kingfisher Beer
    expect(types[6]).toBe('noise');
    expect(types[7]).toBe('subtotal');
    expect(types[8]).toBe('tax_line');   // CGST
    expect(types[9]).toBe('tax_line');   // SGST
    expect(types[10]).toBe('tip');       // Service Charge
    expect(types[11]).toBe('noise');
    expect(types[12]).toBe('total');
    expect(types[13]).toBe('noise');
  });

  it('correctly classifies a US delivery receipt', () => {
    const receipt = [
      'Chipotle',
      '05/10/2026',
      'Burrito Bowl  12.50',
      'Chips & Guac  4.25',
      'Delivery Fee  3.99',
      'Sales Tax  1.35',
      'Tip  2.00',
      'Total  24.09',
    ];

    const result = classifyFirst(receipt);
    const types = result.map((r) => r.lineType);

    expect(types[0]).toBe('merchant_name');
    expect(types[1]).toBe('date');
    expect(types[2]).toBe('item');
    expect(types[3]).toBe('item');
    expect(types[4]).toBe('fee_line');
    expect(types[5]).toBe('tax_line');
    expect(types[6]).toBe('tip');
    expect(types[7]).toBe('total');
  });
});
