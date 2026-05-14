// OCR parser types — internal to this package.
// These describe the input ML Kit gives us and the output we produce.

export type Country = 'IN' | 'US';

export type BillType =
  | 'restaurant'
  | 'grocery'
  | 'delivery'
  | 'utility'
  | 'custom';

// A single line of raw text as ML Kit returns it.
// position is the vertical order on the receipt (top to bottom).
export interface RawLine {
  text: string;
  position: number;
  boundingBox?: { x: number; y: number; width: number; height: number };
}

// What kind of line this is on the receipt.
export type LineType =
  | 'merchant_name'
  | 'date'
  | 'item'
  | 'tax_line'
  | 'fee_line'
  | 'discount'
  | 'tip'
  | 'subtotal'
  | 'total'
  | 'noise';

// Item category — drives which tax/fee rules apply.
export type ItemCategory = 'food' | 'alcohol' | 'non_taxable' | 'other';

// A classified line — raw text plus what we think it is.
export interface ClassifiedLine {
  raw: RawLine;
  lineType: LineType;
  confidence: number; // 0–1
}

// A parsed item from the receipt.
export interface ParsedItem {
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  category: ItemCategory;
  confidence: number;
}

// A parsed charge (tax, fee, tip, discount).
export interface ParsedCharge {
  type: string;         // maps to ChargeType in @split-smart/types
  label: string;        // human-readable, e.g. "CGST @ 2.5%"
  amount: number;
  rate?: number;        // e.g. 0.025 for 2.5%
  confidence: number;
  // True when this tax is already baked into item prices (MRP-inclusive).
  // Split engine must NOT add it on top — it's informational only.
  // Always surfaced to user for confirmation.
  gstInclusive?: boolean;
}

// The full output of the parser — a draft bill ready for the user to review.
export interface ParsedBillDraft {
  country: Country;
  billType: BillType;
  merchantName: string | null;
  date: string | null;          // ISO 8601 date string
  items: ParsedItem[];
  charges: ParsedCharge[];
  subtotal: number | null;
  total: number | null;
  // Confidence scores per top-level field (0–1).
  confidenceScores: {
    merchantName: number;
    date: number;
    items: number;
    charges: number;
    subtotal: number;
    total: number;
  };
  // Fields the user must review — confidence below threshold.
  flaggedFields: string[];
}
