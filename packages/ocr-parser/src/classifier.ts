import type { RawLine, ClassifiedLine, LineType } from './types';

// ─── Pattern banks ────────────────────────────────────────────────────────────
// Each bank is a list of regex patterns. A line matching any pattern in a bank
// is classified as that LineType at the associated confidence.

const PATTERNS: Record<LineType, RegExp[]> = {
  merchant_name: [
    // First 1-2 lines are usually the merchant — handled by position, not regex.
    // These patterns catch explicit merchant identifiers on lower lines.
    /restaurant|cafe|hotel|bistro|kitchen|eatery|bakery|grill|diner|bar\b/i,
    /pvt\.?\s*ltd|llc|inc\.|corp\./i,
  ],
  date: [
    /\b\d{1,2}[\/\-\.]\d{1,2}[\/\-\.]\d{2,4}\b/,        // 12/05/2024, 12-05-24
    /\b\d{4}[\/\-\.]\d{1,2}[\/\-\.]\d{1,2}\b/,           // 2024-05-12
    /\b\d{1,2}\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s+\d{2,4}\b/i,
  ],
  tax_line: [
    /\bcgst\b/i,
    /\bsgst\b/i,
    /\bigst\b/i,
    /\bgst\b/i,
    /\bvat\b/i,
    /\bsales\s*tax\b/i,
    /\bstate\s*tax\b/i,
    /\bcity\s*tax\b/i,
    /\btax\b/i,
  ],
  fee_line: [
    /\bdelivery\s*(fee|charge)?\b/i,
    /\bplatform\s*fee\b/i,
    /\bservice\s*(fee|charge)\b/i,
    /\bpacking\s*(fee|charge)?\b/i,
    /\bconvenience\s*fee\b/i,
    /\bsurge\b/i,
    /\bhandling\s*fee\b/i,
    /\bbag\s*fee\b/i,
  ],
  discount: [
    /\bdiscount\b/i,
    /\bpromo\b/i,
    /\bcoupon\b/i,
    /\boffer\b/i,
    /\bsavings?\b/i,
    /\bcashback\b/i,
    /-\s*[₹$]\s*\d+/,  // negative amount with currency symbol
    /\boff\b/i,
  ],
  tip: [
    /\btip\b/i,
    /\bgratuity\b/i,
    /\bservice\s+charge\b/i,  // India: service charge = tip equivalent
  ],
  subtotal: [
    /\bsubtotal\b/i,
    /\bsub\s*total\b/i,
    /\bitem\s*total\b/i,
    /\bnet\s*amount\b/i,
  ],
  total: [
    /\bgrand\s*total\b/i,
    /\btotal\s*(amount|due|payable)?\b/i,
    /\bamount\s*(due|payable)\b/i,
    /\bbill\s*total\b/i,
    /\bnet\s*payable\b/i,
  ],
  item: [
    // Items have a price at the end — catch the pattern, not specific words.
    /[₹$]\s*\d+(\.\d{1,2})?$/,   // ends with ₹/$ amount
    /\d+\s*[x×]\s*\d+/i,               // quantity × price
  ],
  noise: [
    /^\s*$/,                            // empty line
    /thank\s*you/i,
    /welcome/i,
    /visit\s*again/i,
    /powered\s*by/i,
    /www\.|\.com|\.in\b/i,
    /\b(gstin|fssai|cin)\b/i,          // registration numbers
    /^\*+$/,                            // separator lines like ****
    /^[-=]+$/,                          // separator lines like ----
  ],
};

// ─── Price extraction helper ──────────────────────────────────────────────────

const PRICE_RE = /[₹$]?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d{1,6}(?:\.\d{1,2})?)\s*$/;

export function extractPrice(text: string): number | null {
  const match = text.match(PRICE_RE);
  if (!match) return null;
  // Remove thousands-separator commas, keep decimal point
  const cleaned = match[1].replace(/,(?=\d{3})/g, '');
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : val;
}

// ─── Core classifier ─────────────────────────────────────────────────────────

function matchesAny(text: string, patterns: RegExp[]): boolean {
  return patterns.some((p) => p.test(text));
}

function classifyLine(line: RawLine, isFirstLine: boolean): ClassifiedLine {
  const text = line.text.trim();

  // Noise first — empty or separator lines
  if (matchesAny(text, PATTERNS.noise)) {
    return { raw: line, lineType: 'noise', confidence: 0.95 };
  }

  // Total before subtotal — "total" patterns are more specific
  if (matchesAny(text, PATTERNS.total)) {
    return { raw: line, lineType: 'total', confidence: 0.92 };
  }

  if (matchesAny(text, PATTERNS.subtotal)) {
    return { raw: line, lineType: 'subtotal', confidence: 0.90 };
  }

  // Tax lines — GST/VAT keywords are highly reliable
  if (matchesAny(text, PATTERNS.tax_line)) {
    return { raw: line, lineType: 'tax_line', confidence: 0.93 };
  }

  // Tip before fee — "service charge" appears in both, tip wins
  if (matchesAny(text, PATTERNS.tip)) {
    return { raw: line, lineType: 'tip', confidence: 0.88 };
  }

  if (matchesAny(text, PATTERNS.fee_line)) {
    return { raw: line, lineType: 'fee_line', confidence: 0.90 };
  }

  if (matchesAny(text, PATTERNS.discount)) {
    return { raw: line, lineType: 'discount', confidence: 0.88 };
  }

  if (matchesAny(text, PATTERNS.date)) {
    return { raw: line, lineType: 'date', confidence: 0.85 };
  }

  // Merchant name heuristic — first line of the receipt is almost always the merchant
  if (isFirstLine) {
    return { raw: line, lineType: 'merchant_name', confidence: 0.80 };
  }

  if (matchesAny(text, PATTERNS.merchant_name)) {
    return { raw: line, lineType: 'merchant_name', confidence: 0.72 };
  }

  // Item: has a price at the end and nothing matched above
  if (extractPrice(text) !== null) {
    return { raw: line, lineType: 'item', confidence: 0.78 };
  }

  // Fallback — we don't know what this is
  return { raw: line, lineType: 'noise', confidence: 0.40 };
}

export function classifyLines(lines: RawLine[]): ClassifiedLine[] {
  // Sort by vertical position — top of receipt first
  const sorted = [...lines].sort((a, b) => a.position - b.position);

  // Skip leading noise to find the actual first content line (merchant name)
  let firstContentIdx = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].text.trim().length > 0) {
      firstContentIdx = i;
      break;
    }
  }

  return sorted.map((line, idx) =>
    classifyLine(line, idx === firstContentIdx)
  );
}
