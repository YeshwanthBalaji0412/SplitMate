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
