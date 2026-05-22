import type { Country, RawLine } from '@splitmate/types';
import {
  hasInCurrency, isInTaxLine, isInServiceChargeLine, isInDeliveryFeeLine,
  isInDiscountLine, isCgstLine, isSgstLine,
} from './countries/in';
import {
  hasUsCurrency, isUsTaxLine, isUsTipLine, isUsDeliveryFeeLine,
  isUsDiscountLine,
} from './countries/us';

/**
 * Line types the classifier can assign. The extractor groups lines by
 * these labels to pull structured fields.
 */
export type LineType =
  | 'merchant'
  | 'date'
  | 'item'
  | 'subtotal'
  | 'tax_line'
  | 'tip'
  | 'service'
  | 'delivery'
  | 'platform'
  | 'surge'
  | 'discount'
  | 'total'
  | 'noise';

export type ClassifiedLine = RawLine & { lineType: LineType; confidence: number };

// ---------------------------------------------------------------------------
// Shared patterns (country-independent)
// ---------------------------------------------------------------------------

const SUBTOTAL_PATTERN = /\bsub\s*total\b/i;
const TOTAL_PATTERN = /\b(grand\s*)?total\b/i;
const DATE_PATTERN =
  /\b\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}\b|\b\d{4}[\/-]\d{1,2}[\/-]\d{1,2}\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2}[,.]?\s*\d{2,4}\b/i;
const SURGE_PATTERN = /\bsurge\b/i;
const PLATFORM_FEE_PATTERN = /\bplatform\s*(fee|charge)?\b/i;
const SERVICE_PATTERN = /\bservice\s*(fee|charge)\b/i;
const NOISE_PATTERNS = [
  /\bthank\s*you\b/i,
  /\bhave\s*a\s*nice\s*day\b/i,
  /\bwelcome\b/i,
  /\bpowered\s*by\b/i,
  /\border\s*(id|number|#|no)\b/i,
  /\binvoice\s*(id|number|#|no)\b/i,
  /\bgstin\b/i,
  /\bfssai\b/i,
  /\bpan\b.*\b[A-Z]{5}\d{4}[A-Z]\b/,
  /\btable\s*no\b/i,
  /\bserver\b/i,
  /\bcashier\b/i,
  /\bpayment\s*(method|mode|type)\b/i,
  /\bvisa\b|\bmastercard\b|\bamex\b|\brupay\b/i,
  /\bchange\s*due\b/i,
  /^\s*[-=*_]{3,}\s*$/,
  /^\s*$/, // blank lines
  /\bwww\.\b/i,
  /\b\d{10,}\b/, // phone-number-like strings
  /\baddress\b/i,
];

/**
 * A line that has a number in it (potential price). Used to decide if a
 * line could be an item (has name + price) vs pure noise (no numbers).
 */
const HAS_NUMBER = /\d+[.,]?\d*/;

/**
 * Heuristic: first 1-3 non-blank non-date lines before any item/total are
 * likely the merchant name. We tag them in a second pass.
 */
const MAX_MERCHANT_LINES = 3;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Classify each RawLine into one of the LineType categories. Country
 * drives which tax/fee/discount patterns are checked.
 *
 * The classifier runs in two passes:
 *   Pass 1: label each line based on keyword/pattern matching.
 *   Pass 2: retroactively tag the top lines as 'merchant' if they were
 *           initially classified as 'noise' (common for restaurant names
 *           which have no keyword signals).
 */
export function classifyLines(lines: RawLine[], country: Country): ClassifiedLine[] {
  if (lines.length === 0) return [];

  // Pass 1: keyword-based classification.
  const classified = lines.map((line) => ({
    ...line,
    ...classifyOneLine(line.text, country),
  }));

  // Pass 2: merchant detection. Walk from the top; tag the first
  // contiguous block of noise/date lines (up to MAX_MERCHANT_LINES)
  // before the first item/subtotal/total as merchant.
  let merchantsTagged = 0;
  let foundStructuredLine = false;
  for (let i = 0; i < classified.length && !foundStructuredLine; i++) {
    const c = classified[i]!;
    if (
      c.lineType === 'item' ||
      c.lineType === 'subtotal' ||
      c.lineType === 'total' ||
      c.lineType === 'tax_line'
    ) {
      foundStructuredLine = true;
    } else if (
      (c.lineType === 'noise' || c.lineType === 'date') &&
      merchantsTagged < MAX_MERCHANT_LINES
    ) {
      // Only promote "default noise" (confidence <= 0.6) to merchant.
      // Pattern-matched noise (separators, GSTIN, payment methods) has
      // confidence 0.9 and should stay noise.
      if (c.lineType === 'noise' && c.text.trim().length > 0 && c.confidence < 0.7) {
        classified[i] = { ...c, lineType: 'merchant', confidence: 0.6 };
        merchantsTagged++;
      }
    }
  }

  return classified;
}

// ---------------------------------------------------------------------------
// Single-line classification
// ---------------------------------------------------------------------------

function classifyOneLine(text: string, country: Country): { lineType: LineType; confidence: number } {
  const trimmed = text.trim();
  if (!trimmed) return { lineType: 'noise', confidence: 1 };

  // Noise (very specific patterns)
  for (const pat of NOISE_PATTERNS) {
    if (pat.test(trimmed)) return { lineType: 'noise', confidence: 0.9 };
  }

  // Date
  if (DATE_PATTERN.test(trimmed) && !HAS_NUMBER.test(trimmed.replace(DATE_PATTERN, ''))) {
    return { lineType: 'date', confidence: 0.85 };
  }

  // Subtotal (must come before total check since "subtotal" contains "total")
  if (SUBTOTAL_PATTERN.test(trimmed)) {
    return { lineType: 'subtotal', confidence: 0.95 };
  }

  // Discount (must come before total to avoid matching "total" in discount lines)
  if (country === 'IN' ? isInDiscountLine(trimmed) : isUsDiscountLine(trimmed)) {
    return { lineType: 'discount', confidence: 0.85 };
  }

  // Tax
  if (country === 'IN') {
    if (isCgstLine(trimmed) || isSgstLine(trimmed) || isInTaxLine(trimmed)) {
      return { lineType: 'tax_line', confidence: 0.9 };
    }
  } else {
    if (isUsTaxLine(trimmed)) {
      return { lineType: 'tax_line', confidence: 0.9 };
    }
  }

  // Tip / gratuity (US-primary)
  if (isUsTipLine(trimmed)) {
    return { lineType: 'tip', confidence: 0.9 };
  }

  // Service charge (India-primary, but can appear in US)
  if (country === 'IN' && isInServiceChargeLine(trimmed)) {
    return { lineType: 'service', confidence: 0.85 };
  }
  if (SERVICE_PATTERN.test(trimmed)) {
    return { lineType: 'service', confidence: 0.8 };
  }

  // Surge
  if (SURGE_PATTERN.test(trimmed) && !isInDeliveryFeeLine(trimmed) && !isUsDeliveryFeeLine(trimmed)) {
    return { lineType: 'surge', confidence: 0.8 };
  }

  // Platform fee
  if (PLATFORM_FEE_PATTERN.test(trimmed)) {
    return { lineType: 'platform', confidence: 0.85 };
  }

  // Delivery / packaging fees
  if (country === 'IN' ? isInDeliveryFeeLine(trimmed) : isUsDeliveryFeeLine(trimmed)) {
    return { lineType: 'delivery', confidence: 0.85 };
  }

  // Total (generic — after subtotal, tax, tip, etc. have been checked)
  if (TOTAL_PATTERN.test(trimmed) && !SUBTOTAL_PATTERN.test(trimmed)) {
    return { lineType: 'total', confidence: 0.9 };
  }

  // Item heuristic: has text + a number that looks like a price.
  // Prices typically appear after the name, e.g. "Margherita Pizza 12.99"
  // or "2x Naan ₹80". We check for at least one word + a number.
  const hasPrice = country === 'IN'
    ? /(?:₹|Rs\.?\s*)\s*\d+[.,]?\d*/i.test(trimmed) || /\d+[.,]\d{1,2}\s*$/.test(trimmed)
    : /\$\s*\d+[.,]?\d*/i.test(trimmed) || /\d+[.,]\d{1,2}\s*$/.test(trimmed);
  const hasWords = /[a-zA-Z]{2,}/.test(trimmed);

  if (hasPrice && hasWords) {
    return { lineType: 'item', confidence: 0.75 };
  }

  // Lines that are just numbers (could be a total without a label, prices, etc.)
  if (HAS_NUMBER.test(trimmed) && !hasWords) {
    return { lineType: 'noise', confidence: 0.5 };
  }

  // Default: noise
  return { lineType: 'noise', confidence: 0.5 };
}
