import type { BillRecord, StorageEstimate } from './types';

// How many months back a settled bill must be before it's archivable.
export const ARCHIVE_AFTER_MONTHS = 3;

// ~500 bytes per bill record (items, charges, participants serialised)
const BYTES_PER_BILL = 500;

export function estimateStorage(bills: BillRecord[]): StorageEstimate {
  const settled = bills.filter((b) => b.settledAt !== null);
  const unsettled = bills.filter((b) => b.settledAt === null);

  // archivableAfterDate: bills settled before this date are eligible
  const cutoff = new Date();
  cutoff.setMonth(cutoff.getMonth() - ARCHIVE_AFTER_MONTHS);
  const archivableAfterDate = cutoff.toISOString().slice(0, 10);

  return {
    totalBills: bills.length,
    settledBills: settled.length,
    unsettledBills: unsettled.length,
    estimatedSizeKB: Math.round((bills.length * BYTES_PER_BILL) / 1024),
    archivableAfterDate,
  };
}

export function getArchivableBills(bills: BillRecord[], asOf: string): BillRecord[] {
  const cutoff = new Date(asOf);
  cutoff.setMonth(cutoff.getMonth() - ARCHIVE_AFTER_MONTHS);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  return bills.filter(
    (b) => b.settledAt !== null && b.settledAt < cutoffStr
  );
}
