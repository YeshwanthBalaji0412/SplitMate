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

  it('in-delivery-01: Indian delivery receipt (no GST line, container charge)', () => {
    const draft = parseReceipt({
      lines: loadFixture('in-delivery-01.txt'),
      country: 'IN',
      billType: 'delivery',
    });

    expect(draft).toMatchSnapshot();
  });
});
