import type {
  BillRecord,
  TimeWindow,
  MonthlyReport,
  CategoryBreakdown,
  GroupSummary,
} from './types';

// Main entry point — computes a MonthlyReport for a user from their bill records.
// All computation is in-memory; no DB calls. The caller fetches bills from SQLite
// and passes them here.
export function computeMonthlyReport(
  _userId: string,
  _bills: BillRecord[],
  _window: TimeWindow
): MonthlyReport {
  throw new Error('not implemented');
}

// Breaks down spending by bill category for a given user and bill set.
export function computeCategoryBreakdown(
  _userId: string,
  _bills: BillRecord[]
): CategoryBreakdown[] {
  throw new Error('not implemented');
}

// Per-group summary for a user across a set of bills.
export function computeGroupSummaries(
  _userId: string,
  _bills: BillRecord[]
): GroupSummary[] {
  throw new Error('not implemented');
}

// Fairness delta: positive = user overpaid on average, negative = underpaid.
// Compares actual owed amount to equal share for each bill.
export function computeFairnessDelta(
  _userId: string,
  _bills: BillRecord[]
): number {
  throw new Error('not implemented');
}

// Average days between bill creation and settlement for the user's bills.
export function computeAvgDaysToSettle(
  _userId: string,
  _bills: BillRecord[]
): number | null {
  throw new Error('not implemented');
}

// Number of consecutive days the user's groups settled within 48 hours.
export function computeSettlementStreak(_bills: BillRecord[]): number {
  throw new Error('not implemented');
}
