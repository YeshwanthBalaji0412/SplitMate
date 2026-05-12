import type { ClassifiedLine, Country, ParsedBillDraft, BillType } from './types';

// Extracts structured fields from classified lines, country-aware.
// Built and tested in Step 3.
export function extractFields(
  _lines: ClassifiedLine[],
  _country: Country,
  _billType: BillType
): ParsedBillDraft {
  throw new Error('not implemented');
}
