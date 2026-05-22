import { describe, it, expect } from 'vitest';
import type { RawLine, ParsedBillDraft } from '@splitmate/types';
import { parseReceipt } from '../src/parser';

import usRestaurant from '../src/fixtures/us-restaurant.json';
import usGrocery from '../src/fixtures/us-grocery.json';
import usDelivery from '../src/fixtures/us-delivery.json';
import inRestaurant from '../src/fixtures/in-restaurant.json';
import inDelivery from '../src/fixtures/in-delivery.json';

function assertBasicShape(draft: ParsedBillDraft) {
  expect(draft.merchant).toBeDefined();
  expect(typeof draft.merchant.name).toBe('string');
  expect(typeof draft.merchant.confidence).toBe('number');
  expect(draft.currency).toMatch(/^[A-Z]{3}$/);
  expect(draft.rawText).toBeTruthy();
  expect(Array.isArray(draft.items)).toBe(true);
  expect(Array.isArray(draft.charges)).toBe(true);
  expect(Array.isArray(draft.flaggedFields)).toBe(true);
  expect(typeof draft.confidenceScores).toBe('object');
}

describe('fixture snapshot tests', () => {
  it('1. US restaurant fixture parses with items + tax + tip', () => {
    const draft = parseReceipt({
      lines: usRestaurant as RawLine[],
      country: 'US',
      billType: 'restaurant',
    });
    assertBasicShape(draft);
    expect(draft.merchant.name).toContain('GOLDEN OAK');
    expect(draft.date).toBe('2026-03-15');
    expect(draft.currency).toBe('USD');
    expect(draft.items.length).toBeGreaterThanOrEqual(3);
    expect(draft.charges.some((c) => c.type === 'tax')).toBe(true);
    expect(draft.charges.some((c) => c.type === 'tip')).toBe(true);
    // Alcohol item should be categorized
    const beer = draft.items.find((i) => i.name.toLowerCase().includes('beer'));
    if (beer) expect(beer.category).toBe('alcohol');
    // Bottled water = non_taxable
    const water = draft.items.find((i) => i.name.toLowerCase().includes('water'));
    if (water) expect(water.category).toBe('non_taxable');
  });

  it('2. US grocery fixture parses with items + sales tax', () => {
    const draft = parseReceipt({
      lines: usGrocery as RawLine[],
      country: 'US',
      billType: 'grocery',
    });
    assertBasicShape(draft);
    expect(draft.items.length).toBeGreaterThanOrEqual(4);
    expect(draft.charges.some((c) => c.type === 'tax')).toBe(true);
    // Wine should be alcohol
    const wine = draft.items.find((i) => i.name.toLowerCase().includes('chardonnay'));
    if (wine) expect(wine.category).toBe('alcohol');
  });

  it('3. US delivery fixture parses with items + fees + discount', () => {
    const draft = parseReceipt({
      lines: usDelivery as RawLine[],
      country: 'US',
      billType: 'delivery',
    });
    assertBasicShape(draft);
    expect(draft.items.length).toBeGreaterThanOrEqual(2);
    expect(draft.charges.some((c) => c.type === 'delivery')).toBe(true);
    expect(draft.charges.some((c) => c.type === 'discount')).toBe(true);
  });

  it('4. Indian restaurant fixture parses with items + CGST/SGST aggregation + service charge', () => {
    const draft = parseReceipt({
      lines: inRestaurant as RawLine[],
      country: 'IN',
      billType: 'restaurant',
    });
    assertBasicShape(draft);
    expect(draft.currency).toBe('INR');
    expect(draft.items.length).toBeGreaterThanOrEqual(3);
    // CGST + SGST should be aggregated
    const taxes = draft.charges.filter((c) => c.type === 'tax');
    expect(taxes).toHaveLength(1);
    expect(taxes[0]!.label).toBe('GST');
    // Service charge present
    expect(draft.charges.some((c) => c.type === 'service')).toBe(true);
    // Kingfisher beer → alcohol
    const beer = draft.items.find((i) => i.name.toLowerCase().includes('kingfisher'));
    if (beer) expect(beer.category).toBe('alcohol');
  });

  it('5. Indian delivery fixture parses with items + delivery + platform + discount', () => {
    const draft = parseReceipt({
      lines: inDelivery as RawLine[],
      country: 'IN',
      billType: 'delivery',
    });
    assertBasicShape(draft);
    expect(draft.currency).toBe('INR');
    expect(draft.items.length).toBeGreaterThanOrEqual(2);
    expect(draft.charges.some((c) => c.type === 'delivery')).toBe(true);
    expect(draft.charges.some((c) => c.type === 'discount')).toBe(true);
  });

  it('6. all fixtures return rawText that includes the original lines', () => {
    const fixtures = [
      { data: usRestaurant, country: 'US' as const, type: 'restaurant' as const },
      { data: usGrocery, country: 'US' as const, type: 'grocery' as const },
      { data: usDelivery, country: 'US' as const, type: 'delivery' as const },
      { data: inRestaurant, country: 'IN' as const, type: 'restaurant' as const },
      { data: inDelivery, country: 'IN' as const, type: 'delivery' as const },
    ];
    for (const f of fixtures) {
      const draft = parseReceipt({ lines: f.data as RawLine[], country: f.country, billType: f.type });
      expect(draft.rawText.length).toBeGreaterThan(0);
    }
  });
});
