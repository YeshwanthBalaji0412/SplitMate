import type { BillRecord, StorageEstimate } from './types';

// How many months back a settled bill must be before it's archivable.
export const ARCHIVE_AFTER_MONTHS = 3;

// Estimates storage used by bill data and identifies what can be archived.
// Caller passes all stored bills; this returns a breakdown.
export function estimateStorage(_bills: BillRecord[]): StorageEstimate {
  throw new Error('not implemented');
}

// Filters bills that are safe to archive:
// - fully settled (settledAt is not null)
// - settled more than ARCHIVE_AFTER_MONTHS months ago
export function getArchivableBills(
  _bills: BillRecord[],
  _asOf: string   // ISO 8601 date — "today"
): BillRecord[] {
  throw new Error('not implemented');
}
