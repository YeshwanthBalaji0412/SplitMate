import { describe, it, expect } from 'vitest';
import { estimateStorage, getArchivableBills, ARCHIVE_AFTER_MONTHS } from './storage';
import type { BillRecord } from './types';

function bill(overrides: Partial<BillRecord> & { id: string }): BillRecord {
  return {
    groupId: 'group-1',
    date: '2026-01-01',
    billType: 'restaurant',
    totalAmount: 100,
    currency: 'USD',
    settledAt: null,
    participants: [{ userId: 'alice', owedAmount: 50, paidAmount: 100 }],
    items: [],
    ...overrides,
  };
}

// ─── estimateStorage ──────────────────────────────────────────────────────────

describe('estimateStorage', () => {
  it('returns zeros for empty input', () => {
    const result = estimateStorage([]);
    expect(result.totalBills).toBe(0);
    expect(result.settledBills).toBe(0);
    expect(result.unsettledBills).toBe(0);
    expect(result.estimatedSizeKB).toBe(0);
  });

  it('counts settled vs unsettled correctly', () => {
    const bills = [
      bill({ id: '1', settledAt: '2026-01-10' }),
      bill({ id: '2', settledAt: null }),
      bill({ id: '3', settledAt: '2026-02-01' }),
    ];
    const result = estimateStorage(bills);
    expect(result.totalBills).toBe(3);
    expect(result.settledBills).toBe(2);
    expect(result.unsettledBills).toBe(1);
  });

  it('estimates size proportional to bill count', () => {
    const tenBills = Array.from({ length: 10 }, (_, i) => bill({ id: String(i) }));
    const result = estimateStorage(tenBills);
    // 10 * 500 bytes = 5000 bytes = ~4KB
    expect(result.estimatedSizeKB).toBe(5);
  });

  it('archivableAfterDate is ARCHIVE_AFTER_MONTHS months in the past', () => {
    const result = estimateStorage([]);
    const cutoff = new Date();
    cutoff.setMonth(cutoff.getMonth() - ARCHIVE_AFTER_MONTHS);
    const expected = cutoff.toISOString().slice(0, 10);
    expect(result.archivableAfterDate).toBe(expected);
  });
});

// ─── getArchivableBills ───────────────────────────────────────────────────────

describe('getArchivableBills', () => {
  const asOf = '2026-05-18';

  it('returns empty array for no bills', () => {
    expect(getArchivableBills([], asOf)).toEqual([]);
  });

  it('returns empty array when no bills are settled', () => {
    const bills = [bill({ id: '1', settledAt: null })];
    expect(getArchivableBills(bills, asOf)).toEqual([]);
  });

  it('returns bills settled more than 3 months ago', () => {
    // settled 2026-01-01 is >3 months before 2026-05-18
    const old = bill({ id: '1', settledAt: '2026-01-01' });
    const result = getArchivableBills([old], asOf);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('1');
  });

  it('does not return bills settled exactly on the threshold date', () => {
    // cutoff for 2026-05-18 is 2026-02-18 — settled on that date is NOT archivable
    const threshold = bill({ id: '1', settledAt: '2026-02-18' });
    expect(getArchivableBills([threshold], asOf)).toHaveLength(0);
  });

  it('does not return recently settled bills', () => {
    const recent = bill({ id: '1', settledAt: '2026-04-01' });
    expect(getArchivableBills([recent], asOf)).toHaveLength(0);
  });

  it('does not return unsettled bills regardless of age', () => {
    const old = bill({ id: '1', date: '2025-01-01', settledAt: null });
    expect(getArchivableBills([old], asOf)).toHaveLength(0);
  });

  it('filters correctly from mixed list', () => {
    const bills = [
      bill({ id: 'archivable', settledAt: '2025-12-01' }),
      bill({ id: 'recent', settledAt: '2026-04-20' }),
      bill({ id: 'unsettled', settledAt: null }),
    ];
    const result = getArchivableBills(bills, asOf);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('archivable');
  });
});
