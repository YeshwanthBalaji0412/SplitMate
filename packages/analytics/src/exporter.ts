import type { MonthlyReport, BillRecord, AnalyticsExport } from './types';

// Serialises a report to a JSON string for download or local save.
export function exportToJSON(
  _userId: string,
  _report: MonthlyReport,
  _bills: BillRecord[]
): string {
  throw new Error('not implemented');
}

// Serialises a report to a human-readable CSV string.
// Rows: date, group, bill type, your share, total bill amount.
export function exportToCSV(
  _userId: string,
  _report: MonthlyReport,
  _bills: BillRecord[]
): string {
  throw new Error('not implemented');
}

// Parses a previously exported JSON string back into an AnalyticsExport.
export function importFromJSON(_json: string): AnalyticsExport {
  throw new Error('not implemented');
}
