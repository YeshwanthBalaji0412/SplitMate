import type { BillType, ChargeType, ItemCategory } from './expense';
import type { Country } from './group';

/**
 * A single line of text returned by ML Kit, flattened from blocks/lines/
 * elements. `position` is the line's top-down index. `boundingBox`, when
 * present, lets the parser disambiguate adjacent columns (price vs label).
 */
export type RawLine = {
  text: string;
  position: number;
  boundingBox?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
};

/**
 * Per-field confidence in [0, 1]. Keys are dot-paths matching the fields
 * inside `ParsedBillDraft` (e.g. "merchant.name", "items[2].unitPrice").
 */
export type ConfidenceScores = Record<string, number>;

/**
 * Dot-path identifier of a field the parser was uncertain about.
 * The UI uses this list to draw amber "Review" highlights and tick them
 * off as the user confirms each value.
 */
export type FlaggedField = string;

export type ParsedItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  category: ItemCategory;
  confidence: number;
};

export type ParsedCharge = {
  type: ChargeType;
  label: string;
  amount: number;
  rate?: number;
  confidence: number;
};

/**
 * MLE -> SWE contract.
 *
 * Output of `parseReceipt({ lines, country, billType })`. Every field
 * pre-fills the bill-entry form. Fields below the confidence threshold
 * appear in `flaggedFields`; the UI surfaces only those for review.
 *
 * Parser failure is never a throw -- the parser returns an "empty draft"
 * with all fields flagged so the user can fall back to manual entry.
 */
export type ParsedBillDraft = {
  merchant: {
    name: string;
    /** US-only: 2-letter state code used to look up sales tax rate. */
    state?: string;
    confidence: number;
  };
  /** ISO date `YYYY-MM-DD`. Null if the parser couldn't find a date. */
  date: string | null;
  /** ISO 4217 3-letter (e.g. 'USD', 'INR'). */
  currency: string;
  country: Country;
  billType: BillType;
  subtotal: number;
  total: number;
  items: ParsedItem[];
  charges: ParsedCharge[];
  confidenceScores: ConfidenceScores;
  flaggedFields: FlaggedField[];
  /** Full OCR text, kept for audit + re-parsing if the rules evolve. */
  rawText: string;
};
