/**
 * India-specific receipt patterns and helpers.
 *
 * Indian receipts typically:
 *   - show ₹, Rs, Rs., or INR
 *   - may show CGST + SGST as separate lines (= combined GST)
 *   - may show a single GST or IGST line
 *   - service charge (restaurants, ~10%) is optional and distinct from tax
 *   - MRP prices may be GST-inclusive (flagged for attention)
 *   - delivery/platform fees on Zomato/Swiggy receipts
 *   - discounts ("coupon", "offer") common on delivery
 */

export const IN_CURRENCY_PATTERNS = [/₹/, /\bRs\.?\b/i, /\bINR\b/i];

export const IN_TAX_PATTERNS = [
  /\bGST\b/i,
  /\bCGST\b/i,
  /\bSGST\b/i,
  /\bIGST\b/i,
  /\btax\b/i,
  /\bVAT\b/i,
];

export const IN_CGST_PATTERN = /\bCGST\b/i;
export const IN_SGST_PATTERN = /\bSGST\b/i;

export const IN_SERVICE_CHARGE_PATTERNS = [
  /\bservice\s*charge\b/i,
  /\bservice\s*tax\b/i,
];

export const IN_DELIVERY_PATTERNS = [
  /\bdelivery\s*(fee|charge|charges)?\b/i,
  /\bplatform\s*(fee|charge)?\b/i,
  /\bpackaging\s*(fee|charge|charges)?\b/i,
  /\bsurge\s*(fee|charge)?\b/i,
  /\bconvenience\s*(fee|charge)?\b/i,
  /\brain\s*(fee|charge|surcharge)?\b/i,
  /\bhandling\s*(fee|charge)?\b/i,
  /\bsmall\s*order\s*(fee|surcharge)?\b/i,
];

export const IN_DISCOUNT_PATTERNS = [
  /\bdiscount\b/i,
  /\bcoupon\b/i,
  /\boffer\b/i,
  /\bpromo\b/i,
  /\bsavings?\b/i,
  /\bcashback\b/i,
];

/**
 * Extract a rupee amount from text like "₹120.50" or "Rs 120".
 * Prefers ₹/Rs-prefixed amounts; falls back to the rightmost number.
 * This avoids matching rate percentages like "2.5%" as prices.
 */
export function extractInrAmount(text: string): number | null {
  const isNeg = /[-−]/.test(text) || /\(.*\d.*\)/.test(text);

  // Priority 1: ₹ or Rs-prefixed amount (last occurrence)
  const currMatches = [...text.matchAll(/(?:₹|Rs\.?\s*|INR\s+)(\d{1,9}(?:[.,]\d{1,2})?)/gi)];
  if (currMatches.length > 0) {
    const last = currMatches[currMatches.length - 1]!;
    const value = parseFloat(last[1]!.replace(',', '.'));
    if (!isNaN(value)) return isNeg ? -value : value;
  }

  // Priority 2: rightmost decimal number (not followed by %)
  const decMatches = [...text.matchAll(/(\d{1,9}[.,]\d{1,2})(?!%)/g)];
  if (decMatches.length > 0) {
    const last = decMatches[decMatches.length - 1]!;
    const value = parseFloat(last[1]!.replace(',', '.'));
    if (!isNaN(value)) return isNeg ? -value : value;
  }

  // Priority 3: rightmost bare integer (not followed by %)
  const intMatches = [...text.matchAll(/(\d{1,9})(?!%)/g)];
  if (intMatches.length > 0) {
    const last = intMatches[intMatches.length - 1]!;
    const value = parseFloat(last[1]!);
    if (!isNaN(value)) return isNeg ? -value : value;
  }

  return null;
}

export function hasInCurrency(text: string): boolean {
  return IN_CURRENCY_PATTERNS.some((p) => p.test(text));
}

export function isInTaxLine(text: string): boolean {
  return IN_TAX_PATTERNS.some((p) => p.test(text));
}

export function isCgstLine(text: string): boolean {
  return IN_CGST_PATTERN.test(text);
}

export function isSgstLine(text: string): boolean {
  return IN_SGST_PATTERN.test(text);
}

export function isInServiceChargeLine(text: string): boolean {
  return IN_SERVICE_CHARGE_PATTERNS.some((p) => p.test(text));
}

export function isInDeliveryFeeLine(text: string): boolean {
  return IN_DELIVERY_PATTERNS.some((p) => p.test(text));
}

export function isInDiscountLine(text: string): boolean {
  return IN_DISCOUNT_PATTERNS.some((p) => p.test(text));
}
