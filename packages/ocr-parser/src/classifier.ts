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
    /\bpackaging\s*(fee|charge)?\b/i,
    /\bcontainer\s*(fee|charge)?\b/i,
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
    /\b(gstin|fssai|cin)\b/i,          // registration numbers (full line)
    /^[A-Z0-9]{10,}\s*\d{2}[A-Z]\b/i, // GSTIN format: 15-char alphanumeric
    /^\*+$/,                            // separator lines like ****
    /^[-=]+$/,                          // separator lines like ----
    // Column header rows
    /\b(qty|quantity)\b.{0,30}\b(price|amount|rate|amt)\b/i,
    /\bitem\b.{0,20}\b(qty|price|amount)\b/i,
    /\bdescription\b.{0,30}\b(qty|rate|amount)\b/i,
    // Tax breakdown header rows
    /\btax\s*%\b.{0,30}\b(cgst|sgst|taxable)\b/i,
    // Address indicators
    /\bnagar\b|\bstreet\b|\broad\b|\blane\b|\bnear\b|\bopposite\b|\bfloor\b/i,
    /\bdistrict\b|\bpincode\b|\bpin\s*code\b|\bcbe\b|\bcoimbatore\b/i,
    /\b(ph|phone|mob|mobile|tel|fax)\s*(no|num|number)?[\s:.]/i,
    // Bill/receipt metadata
    /\bbill\s*no\b|\breceipt\s*no\b|\binvoice\s*no\b/i,
    /\btime\s*:/i,                      // TIME: 18:25
    /^\s*p\s*$/i,                       // standalone "P" line (common on thermal printers)
    /\btotal\s*item/i,                  // "TOTAL ITEM(S): 4 /QTY:16"
    /\/qty/i,                           // "/QTY:16"
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

function isPureNumericRow(text: string): boolean {
  // A row of 3+ whitespace-separated tokens that are all numbers/percentages
  // e.g. "5.00 771.43 19.29 19.29 38.57" — tax breakdown data row
  const tokens = text.trim().split(/\s+/);
  if (tokens.length < 3) return false;
  return tokens.every((t) => /^[₹$%]?\d+([.,]\d+)?%?$/.test(t));
}

function classifyLine(line: RawLine, isFirstLine: boolean): ClassifiedLine {
  const text = line.text.trim();

  // Noise first — empty or separator lines
  if (matchesAny(text, PATTERNS.noise)) {
    return { raw: line, lineType: 'noise', confidence: 0.95 };
  }

  // Pure numeric rows — tax breakdown data, not items
  if (isPureNumericRow(text)) {
    return { raw: line, lineType: 'noise', confidence: 0.85 };
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

// ─── Multi-line item merging ──────────────────────────────────────────────────
// When ML Kit wraps a long item name across two lines, line N has no price
// but line N+1 does. Merge them so the extractor sees one complete line.
function mergeWrappedLines(lines: RawLine[]): RawLine[] {
  const merged: RawLine[] = [];
  let i = 0;

  // Find the index of the first non-empty line — never merge it.
  // It's the merchant name, not a wrapped item continuation.
  let firstContentIdx = 0;
  for (let j = 0; j < lines.length; j++) {
    if (lines[j].text.trim().length > 0) { firstContentIdx = j; break; }
  }

  while (i < lines.length) {
    const current = lines[i];
    const next = lines[i + 1];
    const currentHasPrice = extractPrice(current.text) !== null;
    const nextHasPrice = next ? extractPrice(next.text) !== null : false;
    const currentHasText = current.text.trim().length > 0;
    const isFirstLine = i === firstContentIdx;

    // Merge only if: not the first line, no price, has text, next has a price,
    // current looks like a name fragment (has letters, not a separator or keyword line).
    const looksLikeName = /[a-zA-Zऀ-ॿ]/.test(current.text)
      && !/^[-=*]+$/.test(current.text.trim())
      && !matchesAny(current.text, PATTERNS.noise)      // skip known noise lines
      && !matchesAny(current.text, PATTERNS.tax_line)   // skip tax headers
      && !matchesAny(current.text, PATTERNS.subtotal)
      && !matchesAny(current.text, PATTERNS.total);
    if (!isFirstLine && !currentHasPrice && currentHasText && nextHasPrice && looksLikeName) {
      merged.push({
        text: `${current.text.trim()} ${next.text.trim()}`,
        position: current.position,
        boundingBox: current.boundingBox,
      });
      i += 2;
    } else {
      merged.push(current);
      i++;
    }
  }
  return merged;
}

export function classifyLines(lines: RawLine[]): ClassifiedLine[] {
  // Sort by vertical position — top of receipt first
  const sorted = [...lines].sort((a, b) => a.position - b.position);

  // Merge wrapped item names before classifying
  const preMerged = mergeWrappedLines(sorted);

  // Skip leading noise to find the actual first content line (merchant name)
  let firstContentIdx = 0;
  for (let i = 0; i < preMerged.length; i++) {
    if (preMerged[i].text.trim().length > 0) {
      firstContentIdx = i;
      break;
    }
  }

  return preMerged.map((line, idx) =>
    classifyLine(line, idx === firstContentIdx)
  );
}
