import type { RawLine, Country, BillType, ParsedBillDraft } from './types';
import { classifyLines } from './classifier';
import { extractFields } from './extractor';

export interface ParseReceiptInput {
  lines: RawLine[];
  country: Country;
  billType: BillType;
  confidenceThreshold?: number; // default 0.75 — fields below this are flagged for user review
}

export function parseReceipt(input: ParseReceiptInput): ParsedBillDraft {
  const { lines, country, billType, confidenceThreshold = 0.75 } = input;

  const classified = classifyLines(lines);
  const draft = extractFields(classified, country, billType);

  draft.flaggedFields = Object.entries(draft.confidenceScores)
    .filter(([, score]) => score < confidenceThreshold)
    .map(([field]) => field);

  return draft;
}
