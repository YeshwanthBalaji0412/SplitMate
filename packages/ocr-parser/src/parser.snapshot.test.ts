import { describe, it, expect } from 'vitest';
import { parseReceipt } from './parser';
import { loadFixture } from './fixtures/loader';

describe('parser snapshots — real receipts', () => {
  it('in-delivery-01: Indian delivery receipt (no GST line, container charge)', () => {
    const draft = parseReceipt({
      lines: loadFixture('in-delivery-01.txt'),
      country: 'IN',
      billType: 'delivery',
    });

    expect(draft).toMatchSnapshot();
  });
});
