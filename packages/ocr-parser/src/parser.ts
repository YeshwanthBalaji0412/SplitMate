import type { RawLine, Country, BillType, ParsedBillDraft } from './types';
import { classifyLines } from './classifier';
import { extractFields } from './extractor';

export interface ParseReceiptInput {
  lines: RawLine[];
  country: Country;
  billType: BillType;
  confidenceThreshold?: number; // default 0.75 — fields below this are flagged
}

// Main entry point. Takes raw ML Kit lines, returns a draft bill.
// Orchestrates: classify → extract → flag low-confidence fields.
// Built and tested in Step 4.
export function parseReceipt(input: ParseReceiptInput): ParsedBillDraft {
  const { lines, country, billType, confidenceThreshold = 0.75 } = input;

  const classified = classifyLines(lines);
  const draft = extractFields(classified, country, billType);

  // Flag any field whose confidence is below the threshold
  draft.flaggedFields = Object.entries(draft.confidenceScores)
    .filter(([, score]) => score < confidenceThreshold)
    .map(([field]) => field);

  return draft;
}
