import { describe, it, expect } from 'vitest';
import type { RawLine } from '@splitmate/types';
import { classifyLines } from '../src/classifier';

function line(text: string, position = 0): RawLine {
  return { text, position };
}

function classify(text: string, country: 'US' | 'IN' = 'US') {
  const result = classifyLines([line(text, 0)], country);
  return result[0]!;
}

describe('classifier', () => {
  // --- Item detection ---
  it('1. detects a US item line with $ price', () => {
    expect(classify('Grilled Salmon $24.00').lineType).toBe('item');
  });
  it('2. detects a US item with leading quantity', () => {
    expect(classify('2x Garlic Bread $9.00').lineType).toBe('item');
  });
  it('3. detects an Indian item line with ₹ price', () => {
    expect(classify('Butter Chicken ₹520', 'IN').lineType).toBe('item');
  });
  it('4. detects an item line with Rs price', () => {
    expect(classify('Masala Chai Rs 80', 'IN').lineType).toBe('item');
  });
  it('5. detects item with trailing decimal', () => {
    expect(classify('Avocado Toast 16.50').lineType).toBe('item');
  });

  // --- Total / subtotal ---
  it('6. detects subtotal line', () => {
    expect(classify('Subtotal $59.00').lineType).toBe('subtotal');
  });
  it('7. detects sub total with space', () => {
    expect(classify('Sub Total ₹1530', 'IN').lineType).toBe('subtotal');
  });
  it('8. detects total line', () => {
    expect(classify('Total $74.87').lineType).toBe('total');
  });
  it('9. detects grand total', () => {
    expect(classify('Grand Total ₹1759.50', 'IN').lineType).toBe('total');
  });

  // --- Tax ---
  it('10. detects US sales tax line', () => {
    expect(classify('Sales Tax $4.87').lineType).toBe('tax_line');
  });
  it('11. detects generic tax line', () => {
    expect(classify('Tax $2.10').lineType).toBe('tax_line');
  });
  it('12. detects CGST line (India)', () => {
    expect(classify('CGST @ 2.5% ₹38.25', 'IN').lineType).toBe('tax_line');
  });
  it('13. detects SGST line (India)', () => {
    expect(classify('SGST @ 2.5% ₹38.25', 'IN').lineType).toBe('tax_line');
  });
  it('14. detects GST line (India)', () => {
    expect(classify('GST ₹25.30', 'IN').lineType).toBe('tax_line');
  });

  // --- Tip ---
  it('15. detects tip line', () => {
    expect(classify('Tip $11.00').lineType).toBe('tip');
  });
  it('16. detects gratuity line', () => {
    expect(classify('Gratuity $8.50').lineType).toBe('tip');
  });

  // --- Fees ---
  it('17. detects delivery fee', () => {
    expect(classify('Delivery Fee $3.99').lineType).toBe('delivery');
  });
  it('18. detects platform fee', () => {
    expect(classify('Platform Fee ₹7', 'IN').lineType).toBe('platform');
  });
  it('19. detects service charge (India)', () => {
    expect(classify('Service Charge 10% ₹153', 'IN').lineType).toBe('service');
  });

  // --- Discount ---
  it('20. detects discount line', () => {
    expect(classify('Discount -$3.00').lineType).toBe('discount');
  });
  it('21. detects coupon discount (India)', () => {
    expect(classify('Coupon Discount -₹100', 'IN').lineType).toBe('discount');
  });

  // --- Noise ---
  it('22. labels blank line as noise', () => {
    expect(classify('   ').lineType).toBe('noise');
  });
  it('23. labels separator as noise', () => {
    expect(classify('----------').lineType).toBe('noise');
  });
  it('24. labels thank-you line as noise', () => {
    expect(classify('Thank you for dining with us!').lineType).toBe('noise');
  });
  it('25. labels GSTIN as noise', () => {
    expect(classify('GSTIN: 07AABCU9603R1ZM', 'IN').lineType).toBe('noise');
  });
  it('26. labels payment method as noise', () => {
    expect(classify('VISA ****1234').lineType).toBe('noise');
  });

  // --- Merchant detection (pass 2) ---
  it('27. tags top line as merchant when followed by items', () => {
    const lines: RawLine[] = [
      { text: 'THE GOLDEN OAK', position: 0 },
      { text: 'Grilled Salmon $24.00', position: 1 },
    ];
    const result = classifyLines(lines, 'US');
    expect(result[0]!.lineType).toBe('merchant');
    expect(result[1]!.lineType).toBe('item');
  });

  // --- Confidence ---
  it('28. returns confidence > 0 for every classified line', () => {
    const result = classifyLines(
      [line('Subtotal $59.00'), line('Tax $4.87'), line('Total $63.87')],
      'US',
    );
    for (const r of result) {
      expect(r.confidence).toBeGreaterThan(0);
    }
  });
});
