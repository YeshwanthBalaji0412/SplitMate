import { describe, it, expect } from 'vitest';
import { parseReceipt } from './parser';
import { loadFixture } from './fixtures/loader';

describe('parser snapshots — real receipts', () => {
  it('in-restaurant-01: Indian restaurant receipt (GST-inclusive, SI numbers, Pk quantities)', () => {
    const draft = parseReceipt({
      lines: loadFixture('in-restaurant-01.txt'),
      country: 'IN',
      billType: 'restaurant',
    });

    expect(draft).toMatchSnapshot();
  });

  it('us-grocery-02: Green Supermarket (multi-line merchant, qty prefix items, no tax)', () => {
    const draft = parseReceipt({
      lines: loadFixture('us-grocery-02.txt'),
      country: 'US',
      billType: 'grocery',
    });
    expect(draft).toMatchSnapshot();
  });

  it('us-grocery-03: Dollar Tree (N-suffix prices, OCR noise, tagline with price)', () => {
    const draft = parseReceipt({
      lines: loadFixture('us-grocery-03.txt'),
      country: 'US',
      billType: 'grocery',
    });
    expect(draft).toMatchSnapshot();
  });

  it('us-grocery-01: US grocery receipt (discounts, negative prices, payment lines, savings summary)', () => {
    const draft = parseReceipt({
      lines: loadFixture('us-grocery-01.txt'),
      country: 'US',
      billType: 'grocery',
    });

    expect(draft).toMatchSnapshot();
  });

  it('us-delivery-02: UberEats receipt (US, 2x quantity, delivery fee, order note block)', () => {
    const draft = parseReceipt({
      lines: loadFixture('us-delivery-02.txt'),
      country: 'US',
      billType: 'delivery',
    });

    expect(draft).toMatchSnapshot();
  });

  it('us-delivery-01: UberEats receipt (US, single item with modifiers, tax additive)', () => {
    const draft = parseReceipt({
      lines: loadFixture('us-delivery-01.txt'),
      country: 'US',
      billType: 'delivery',
    });

    expect(draft).toMatchSnapshot();
  });

  it('in-delivery-01: Indian delivery receipt (no GST line, container charge)', () => {
    const draft = parseReceipt({
      lines: loadFixture('in-delivery-01.txt'),
      country: 'IN',
      billType: 'delivery',
    });

    expect(draft).toMatchSnapshot();
  });
});
