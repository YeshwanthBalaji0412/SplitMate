/**
 * US-specific receipt patterns and helpers.
 *
 * US receipts typically:
 *   - show $ or USD
 *   - list items at pre-tax prices
 *   - show sales tax as an additive line at the bottom
 *   - tip is a separate line (restaurants) or absent (grocery/delivery)
 *   - subtotal appears before tax, total after
 */

export const US_CURRENCY_PATTERNS = [/\$/, /USD/i];

export const US_TAX_PATTERNS = [
  /\bsales\s*tax\b/i,
  /\btax\b/i,
  /\bstate\s*tax\b/i,
  /\bcounty\s*tax\b/i,
  /\bcity\s*tax\b/i,
  /\blocal\s*tax\b/i,
];

export const US_TIP_PATTERNS = [
  /\btip\b/i,
  /\bgratuity\b/i,
  /\bgratuity\s*added\b/i,
];

export const US_DELIVERY_PATTERNS = [
  /\bdelivery\s*(fee|charge)?\b/i,
  /\bservice\s*(fee|charge)\b/i,
  /\bplatform\s*(fee|charge)?\b/i,
  /\bregulatory\s*response\s*fee\b/i,
  /\bsmall\s*order\s*fee\b/i,
  /\bsurge\b/i,
  /\bbag\s*(fee|charge)\b/i,
];

export const US_DISCOUNT_PATTERNS = [
  /\bdiscount\b/i,
  /\bcoupon\b/i,
  /\bpromo\b/i,
  /\bsavings?\b/i,
  /\breward\b/i,
  /\boff\b/i,
];

/**
 * Extract a dollar amount from text like "$12.34" or "12.34".
 * Prefers a $-prefixed amount; falls back to the rightmost decimal number.
 * This avoids matching leading quantity prefixes like "2x" as prices.
 */
export function extractUsDollarAmount(text: string): number | null {
  const isNeg = /[-−]/.test(text) || /\(.*\d.*\)/.test(text);

  // Priority 1: $-prefixed amount (last occurrence wins for multi-$ lines)
  const dollarMatches = [...text.matchAll(/\$\s*(\d{1,7}(?:[.,]\d{1,2})?)/g)];
  if (dollarMatches.length > 0) {
    const last = dollarMatches[dollarMatches.length - 1]!;
    const value = parseFloat(last[1]!.replace(',', '.'));
    if (!isNaN(value)) return isNeg ? -value : value;
  }

  // Priority 2: rightmost number with a decimal point (looks like a price)
  const decimalMatches = [...text.matchAll(/(\d{1,7}[.,]\d{1,2})/g)];
  if (decimalMatches.length > 0) {
    const last = decimalMatches[decimalMatches.length - 1]!;
    const value = parseFloat(last[1]!.replace(',', '.'));
    if (!isNaN(value)) return isNeg ? -value : value;
  }

  // Priority 3: rightmost bare integer (e.g. "Total 42")
  const intMatches = [...text.matchAll(/(\d{1,7})/g)];
  if (intMatches.length > 0) {
    const last = intMatches[intMatches.length - 1]!;
    const value = parseFloat(last[1]!);
    if (!isNaN(value)) return isNeg ? -value : value;
  }

  return null;
}

/** Check if a line looks like it contains US currency. */
export function hasUsCurrency(text: string): boolean {
  return US_CURRENCY_PATTERNS.some((p) => p.test(text));
}

export function isUsTaxLine(text: string): boolean {
  return US_TAX_PATTERNS.some((p) => p.test(text));
}

export function isUsTipLine(text: string): boolean {
  return US_TIP_PATTERNS.some((p) => p.test(text));
}

export function isUsDeliveryFeeLine(text: string): boolean {
  return US_DELIVERY_PATTERNS.some((p) => p.test(text));
}

export function isUsDiscountLine(text: string): boolean {
  return US_DISCOUNT_PATTERNS.some((p) => p.test(text));
}
