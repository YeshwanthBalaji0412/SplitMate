import type { BillType, Country, ParsedBillDraft, ConfidenceScores, FlaggedField, RawLine } from '@splitmate/types';
import { classifyLines } from './classifier';
import { extractFields } from './extractor';

const CONFIDENCE_THRESHOLD = 0.6;

/**
 * Top-level entry point of the OCR parser pipeline.
 *
 *   RawLine[]  ─→  classifier  ─→  extractor  ─→  parser (this file)
 *
 * The parser:
 *   1. Classifies each line (line type + per-line confidence).
 *   2. Extracts structured fields from classified lines.
 *   3. Computes per-field confidence scores.
 *   4. Flags low-confidence fields for user review.
 *   5. Assembles the final ParsedBillDraft.
 *
 * **Failure mode**: never throws on bad input. If parsing fails, returns
 * a minimal draft with all fields flagged so the caller can fall back to
 * manual entry. The `rawText` field is always populated.
 */
export function parseReceipt(input: {
  lines: RawLine[];
  country: Country;
  billType: BillType;
}): ParsedBillDraft {
  const { lines, country, billType } = input;
  const rawText = lines.map((l) => l.text).join('\n');

  // Guard: empty input → fully-flagged empty draft.
  if (lines.length === 0) {
    return emptyDraft({ country, billType, rawText: '' });
  }

  try {
    const classified = classifyLines(lines, country);
    const fields = extractFields(classified, country, billType);

    // --- Compute confidence scores ---
    const scores: ConfidenceScores = {};
    const flagged: FlaggedField[] = [];

    // Merchant
    const merchantConf = fields.merchant ? avgConfidence(classified, 'merchant') : 0;
    scores['merchant.name'] = merchantConf;
    if (merchantConf < CONFIDENCE_THRESHOLD || !fields.merchant) flagged.push('merchant.name');

    // Date
    const dateConf = fields.date ? avgConfidence(classified, 'date') : 0;
    scores['date'] = dateConf;
    if (!fields.date || dateConf < CONFIDENCE_THRESHOLD) flagged.push('date');

    // Subtotal
    scores['subtotal'] = fields.subtotal != null ? avgConfidence(classified, 'subtotal') : 0;
    if (fields.subtotal == null) flagged.push('subtotal');

    // Total
    const totalConf = fields.total != null ? avgConfidence(classified, 'total') : 0;
    scores['total'] = totalConf;
    if (fields.total == null || totalConf < CONFIDENCE_THRESHOLD) flagged.push('total');

    // Subtotal/total mismatch check
    if (fields.subtotal != null && fields.total != null && fields.items.length > 0) {
      const itemSum = fields.items.reduce((s, i) => s + i.totalPrice, 0);
      const chargeSum = fields.charges.reduce((s, c) => s + c.amount, 0);
      const expectedTotal = Math.round((itemSum + chargeSum) * 100) / 100;
      if (Math.abs(expectedTotal - fields.total) > 1) {
        // Significant mismatch — flag total for review.
        if (!flagged.includes('total')) flagged.push('total');
        scores['total'] = Math.min(scores['total'] ?? 0, 0.4);
      }
    }

    // Items
    const itemConf = fields.items.length > 0 ? avgConfidence(classified, 'item') : 0;
    fields.items.forEach((item, idx) => {
      const nameKey = `items[${idx}].name`;
      const priceKey = `items[${idx}].totalPrice`;
      scores[nameKey] = itemConf;
      scores[priceKey] = itemConf;
      if (itemConf < CONFIDENCE_THRESHOLD) {
        flagged.push(nameKey);
        flagged.push(priceKey);
      }
    });

    // Charges
    fields.charges.forEach((charge, idx) => {
      const key = `charges[${idx}].amount`;
      // Tax/fee lines are typically well-structured (keyword + amount).
      const lineTypes = charge.type === 'tax' ? 'tax_line' : charge.type;
      const conf = avgConfidence(classified, lineTypes);
      scores[key] = conf;
      if (conf < CONFIDENCE_THRESHOLD) flagged.push(key);
    });

    // --- Assemble draft ---
    const subtotalValue = fields.subtotal ?? fields.items.reduce((s, i) => s + i.totalPrice, 0);
    const totalValue =
      fields.total ??
      Math.round(
        (subtotalValue + fields.charges.reduce((s, c) => s + c.amount, 0)) * 100,
      ) / 100;

    return {
      merchant: {
        name: fields.merchant ?? '',
        confidence: merchantConf,
      },
      date: fields.date,
      currency: fields.currency,
      country,
      billType,
      subtotal: Math.round(subtotalValue * 100) / 100,
      total: Math.round(totalValue * 100) / 100,
      items: fields.items.map((item) => ({
        name: item.name,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        category: item.category,
        confidence: itemConf,
      })),
      charges: fields.charges.map((charge) => ({
        type: charge.type,
        label: charge.label,
        amount: charge.amount,
        rate: charge.rate,
        confidence: scores[`charges[${fields.charges.indexOf(charge)}].amount`] ?? 0.5,
      })),
      confidenceScores: scores,
      flaggedFields: flagged,
      rawText,
    };
  } catch {
    // Any unexpected error → return a safe, fully-flagged empty draft.
    return emptyDraft({ country, billType, rawText });
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function avgConfidence(
  lines: Array<{ lineType: string; confidence: number }>,
  targetType: string,
): number {
  const matching = lines.filter((l) => l.lineType === targetType);
  if (matching.length === 0) return 0;
  return matching.reduce((s, l) => s + l.confidence, 0) / matching.length;
}

function emptyDraft(ctx: {
  country: Country;
  billType: BillType;
  rawText: string;
}): ParsedBillDraft {
  return {
    merchant: { name: '', confidence: 0 },
    date: null,
    currency: ctx.country === 'IN' ? 'INR' : 'USD',
    country: ctx.country,
    billType: ctx.billType,
    subtotal: 0,
    total: 0,
    items: [],
    charges: [],
    confidenceScores: {},
    flaggedFields: ['merchant.name', 'date', 'subtotal', 'total'],
    rawText: ctx.rawText,
  };
}
