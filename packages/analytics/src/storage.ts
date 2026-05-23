import type { BillRecord } from './types';

/**
 * Storage management helpers. Identifies bills eligible for archiving
 * (settled 3+ months ago) so the UI can show the user what they can
 * safely clean up.
 *
 * No actual deletion — the caller decides what to do with the list.
 */

const THREE_MONTHS_MS = 90 * 24 * 60 * 60 * 1000;

export type StorageEstimate = {
  totalBills: number;
  activeBills: number;
  archivableBills: number;
  archivableIds: string[];
};

export function estimateStorage(records: BillRecord[]): StorageEstimate {
  const now = Date.now();
  const archivable = records.filter((r) => {
    if (!r.settledAt) return false;
    const settledTime = new Date(r.settledAt).getTime();
    return now - settledTime >= THREE_MONTHS_MS;
  });

  return {
    totalBills: records.length,
    activeBills: records.filter((r) => !r.settledAt).length,
    archivableBills: archivable.length,
    archivableIds: archivable.map((r) => r.id),
  };
}

export function getArchivableBills(records: BillRecord[]): BillRecord[] {
  const now = Date.now();
  return records.filter((r) => {
    if (!r.settledAt) return false;
    return now - new Date(r.settledAt).getTime() >= THREE_MONTHS_MS;
  });
}
