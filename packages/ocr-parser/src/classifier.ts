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
    /\btotal\s*before\s*(savings?|discount)\b/i, // "Total before savings" = pre-discount subtotal
  ],
  total: [
    /\bgrand\s*total\b/i,
    /\btotal\s*after\s*(savings?|discount)\b/i, // "Total after savings" — takes priority over plain Total
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
    /\bpin\s*:/i,                       // "PIN: 068 78 715"
    /^\+\d[\d\s\-()]{7,}/,             // "+1 312-766-8835"
    /^\(\d{3}\)\s*\d{3}[-\s]\d{4}/,    // "(215) 491-1617" US phone format
    // Bill/receipt metadata
    /\bbill\s*no\b|\breceipt\s*no\b|\binvoice\s*no\b/i,
    /\btime\s*:/i,                      // TIME: 18:25
    /^\s*p\s*$/i,                       // standalone "P" line (thermal printer artifact)
    /\btotal\s*item/i,                  // "TOTAL ITEM(S): 4 /QTY:16"
    /\/qty/i,                           // "/QTY:16"
    // UberEats / delivery app metadata
    /\border\s*(details?|note)\b/i,    // "Order Details:", "ORDER NOTE"
    /\bplaced\s*:/i,                    // "Placed: Mon May 11..."
    /\bprepare\s*by\b/i,               // "Prepare by Mon May 11..."
    /\bcustomer\s*info\b/i,            // "Customer Info"
    /\bprepaid\b/i,                    // "PREPAID - Do Not Charge"
    /\bordermark\b|\bomid\b/i,         // "Ordermark omid-0000-6480"
    /\bdo\s*not\s*charge\b/i,
    /\binternal\s*id\b/i,              // "INTERNAL ID #3honn"
    /\bdelivery\s*date\s*:/i,          // "Delivery date:"
    /\breceived\s*:/i,                 // "Received: Thu Jul 29..."
    /\breturn\s*customer\b/i,          // order notes: "Return customer (4 orders)..."
    /\bdon'?t\s+forget\b/i,           // order notes: "don't forget the garlic aioli"
    // Order/tracking codes — short alphanumeric strings (F0006, #12345)
    /^[A-Z]?\d{3,6}$|^#\d+$/i,        // "F0006", "#190"
    // Barcodes — long all-digit strings
    /^\d{8,}$/,                         // "1234567890012"
    // Store/location identifiers
    /\bst[#\s]*\d+\b|\bstore\s*#?\s*\d+/i, // "St##1 1693", "Store #1693"
    // Lines starting with # or ## (OCR artifacts from bold/large text)
    /^#{2,}/,                           // "###ington PA..."
    // Exemption/zero-tax lines
    /\b(general\s*ex(em|empt?)|tax\s*ex(em|empt?))\b/i,
    // Promotional taglines with store brand
    /\bwhere\s+every/i,                 // "Where Everything's $1.00"
    /\bshop\s+on.?line\b/i,            // "Now Shop On-Line at..."
    // Item modifier lines — start with "- " (customization options)
    /^\s*-\s+[A-Za-z]/,               // "- Medium", "- House Special..."
    // Delivery platform labels
    /^delivery$/i,                      // standalone "Delivery" label (not a fee)
    /^pickup$/i,
    // Section headers — "END EASYSHOP ORDER", "YOUR SAVINGS SUMMARY"
    /^(end|your|our)\s+\w.{3,}\s+(order|summary|section)\s*$/i,
    // Payment method lines — EGift, Cash, Credit, Debit, Change, Tender
    /^(egift|e-gift|gift\s*card|cash|credit|debit|visa|mastercard|amex|change|tender|paid)\b/i,
    // Savings / loyalty summary lines
    /\b(year.to.date|ytd)\s*(savings?|total)/i,  // "YEAR-TO-DATE SAVINGS"
    /\bcard\s*savings?\b/i,                       // "Stop & Shop Card Savings"
    /\bpersonal\s*thanks?\b/i,                    // "PERSONAL THANKS SAVINGS"
    /\btotal\s*(stop|card|loyalty|reward|club)\b/i,
    /\byour\s*total\s*savings?\b/i,               // "Your Total Savings $24.04" (not a charge)
    /\* \*/,                                       // "* * * * * *" separator variant
  ],
};

// ─── Price extraction helper ──────────────────────────────────────────────────

// Matches optional negative sign, optional currency symbol, then the number.
// Allows trailing: * (grocery discount marker), single alpha (N=non-taxable,
// T=taxable, F=food-exempt on POS systems), and trailing whitespace.
const PRICE_RE = /(-?)\s*[₹$]?\s*(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?|\d{1,6}(?:\.\d{1,2})?)[\s*]*[NTFX]?\s*$/;

export function extractPrice(text: string): number | null {
  const match = text.match(PRICE_RE);
  if (!match) return null;
  const sign = match[1] === '-' ? -1 : 1;
  const cleaned = match[2].replace(/,(?=\d{3})/g, '');
  const val = parseFloat(cleaned);
  return isNaN(val) ? null : sign * val;
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

  // Negative price = discount even without discount keywords
  // e.g. "WH/SDL GR GRAPES SCP -0.77 *" on grocery receipts
  // Guard: don't fire on date lines (YYYY-MM-DD ends in negative-looking number)
  const price = extractPrice(text);
  const looksLikeDate = matchesAny(text, PATTERNS.date);
  if (price !== null && price < 0 && !looksLikeDate) {
    return { raw: line, lineType: 'discount', confidence: 0.82 };
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

  // Find first two non-empty content lines — never merge either of them.
  // Line 1 is the merchant name; line 2 may be a merchant name continuation.
  let firstContentIdx = -1;
  let secondContentIdx = -1;
  for (let j = 0; j < lines.length; j++) {
    if (lines[j].text.trim().length > 0) {
      if (firstContentIdx === -1) firstContentIdx = j;
      else if (secondContentIdx === -1) {
        // Protect second line only if both are short pure-text lines (1-2 words each)
        // indicating a genuine two-line merchant name like "Green" + "Supermarket".
        const firstLine = lines[firstContentIdx].text.trim();
        const firstWords = firstLine.split(/\s+/).length;
        const secondWords = lines[j].text.trim().split(/\s+/).length;
        const isShortPair = isMerchantContinuation(lines[j])
          && /^[A-Za-z\s&',.-]+$/.test(firstLine)
          && firstWords <= 2 && secondWords === 1; // second must be single word
        if (isShortPair) secondContentIdx = j;
        break;
      }
    }
  }
  if (firstContentIdx === -1) firstContentIdx = 0;

  while (i < lines.length) {
    const current = lines[i];
    const next = lines[i + 1];
    const currentHasPrice = extractPrice(current.text) !== null;
    const nextHasPrice = next ? extractPrice(next.text) !== null : false;
    const currentHasText = current.text.trim().length > 0;
    const isFirstLine = i === firstContentIdx;

    // Merge only if: not the first line, no price, has text, next has a price,
    // current looks like a name fragment (has letters, not a separator or keyword line).
    const isProtectedLine = i === firstContentIdx || i === secondContentIdx;
    const looksLikeName = /[a-zA-Zऀ-ॿ]/.test(current.text)
      && !/^[-=*]+$/.test(current.text.trim())
      && !matchesAny(current.text, PATTERNS.noise)
      && !matchesAny(current.text, PATTERNS.tax_line)
      && !matchesAny(current.text, PATTERNS.subtotal)
      && !matchesAny(current.text, PATTERNS.total);
    if (!isProtectedLine && !currentHasPrice && currentHasText && nextHasPrice && looksLikeName) {
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

// Detect merchant name continuation: a line that is pure text (no digits)
// appearing immediately after the first content line.
// e.g. "Green" → "Supermarket" — both are the merchant name split across two lines.
function isMerchantContinuation(line: RawLine): boolean {
  const text = line.text.trim();
  return text.length > 0 && /^[A-Za-z\s&',.-]+$/.test(text);
}

export function classifyLines(lines: RawLine[]): ClassifiedLine[] {
  // Sort by vertical position — top of receipt first
  const sorted = [...lines].sort((a, b) => a.position - b.position);

  // Merge wrapped item names before classifying
  const preMerged = mergeWrappedLines(sorted);

  // Find first and second content lines for merchant name detection
  let firstContentIdx = -1;
  let secondContentIdx = -1;
  for (let i = 0; i < preMerged.length; i++) {
    if (preMerged[i].text.trim().length > 0) {
      if (firstContentIdx === -1) firstContentIdx = i;
      else if (secondContentIdx === -1) { secondContentIdx = i; break; }
    }
  }

  return preMerged.map((line, idx) => {
    // Second content line is merchant continuation if it's pure text
    const isMerchantLine = idx === firstContentIdx ||
      (idx === secondContentIdx && isMerchantContinuation(line));
    return classifyLine(line, isMerchantLine);
  });
}
