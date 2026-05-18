import { describe, it, expect } from 'vitest';
import { exportToJSON, exportToCSV, importFromJSON } from './exporter';
import { computeMonthlyReport } from './aggregator';
import type { BillRecord, MonthlyReport } from './types';

function bill(overrides: Partial<BillRecord> & { id: string }): BillRecord {
  const totalAmount = overrides.totalAmount ?? 100;
  return {
    groupId: 'group-1',
    date: '2026-05-01',
    billType: 'restaurant',
    totalAmount,
    currency: 'USD',
    settledAt: null,
    participants: [
      { userId: 'alice', owedAmount: totalAmount / 2, paidAmount: totalAmount },
      { userId: 'bob', owedAmount: totalAmount / 2, paidAmount: 0 },
    ],
    items: [],
    ...overrides,
  };
}

const WINDOW = { from: '2026-05-01', to: '2026-05-31' };

function makeReport(bills: BillRecord[]): MonthlyReport {
  return computeMonthlyReport('alice', bills, WINDOW);
}

// ─── exportToJSON / importFromJSON ────────────────────────────────────────────

describe('exportToJSON', () => {
  it('produces valid JSON', () => {
    const bills = [bill({ id: '1' })];
    const report = makeReport(bills);
    const json = exportToJSON('alice', report, bills);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('round-trips through importFromJSON', () => {
    const bills = [bill({ id: '1' }), bill({ id: '2', billType: 'grocery' })];
    const report = makeReport(bills);
    const json = exportToJSON('alice', report, bills);
    const parsed = importFromJSON(json);
    expect(parsed.userId).toBe('alice');
    expect(parsed.report.totalBills).toBe(2);
    expect(parsed.rawTotals.bills).toHaveLength(2);
    expect(parsed.generatedAt).toBeTruthy();
  });

  it('includes all bills in rawTotals', () => {
    const bills = Array.from({ length: 5 }, (_, i) => bill({ id: String(i) }));
    const report = makeReport(bills);
    const parsed = importFromJSON(exportToJSON('alice', report, bills));
    expect(parsed.rawTotals.bills).toHaveLength(5);
  });
});

// ─── exportToCSV ──────────────────────────────────────────────────────────────

describe('exportToCSV', () => {
  it('returns only a header row for empty bills', () => {
    const report = makeReport([]);
    const csv = exportToCSV('alice', report, []);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^date,/);
  });

  it('has correct number of rows (header + one per user bill)', () => {
    const bills = [bill({ id: '1' }), bill({ id: '2', billType: 'grocery' })];
    const report = makeReport(bills);
    const csv = exportToCSV('alice', report, bills);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(3); // header + 2 bills
  });

  it('does not include bills where user is not a participant', () => {
    const aliceBill = bill({ id: '1' });
    const bobOnly = bill({
      id: '2',
      participants: [{ userId: 'bob', owedAmount: 100, paidAmount: 100 }],
    });
    const report = makeReport([aliceBill, bobOnly]);
    const csv = exportToCSV('alice', report, [aliceBill, bobOnly]);
    const lines = csv.split('\r\n');
    expect(lines).toHaveLength(2); // header + alice's bill only
  });

  it('quotes cells containing commas', () => {
    const commaItem = bill({
      id: '1',
      groupId: 'group,with,commas',
    });
    const report = makeReport([commaItem]);
    const csv = exportToCSV('alice', report, [commaItem]);
    expect(csv).toContain('"group,with,commas"');
  });

  it('uses CRLF line endings (RFC 4180)', () => {
    const bills = [bill({ id: '1' }), bill({ id: '2' })];
    const report = makeReport(bills);
    const csv = exportToCSV('alice', report, bills);
    expect(csv).toContain('\r\n');
    // No bare LF outside CRLF
    expect(csv.replace(/\r\n/g, '')).not.toContain('\n');
  });

  it('marks settled bills correctly', () => {
    const settledBill = bill({ id: '1', settledAt: '2026-05-10' });
    const unsettledBill = bill({ id: '2', settledAt: null });
    const report = makeReport([settledBill, unsettledBill]);
    const csv = exportToCSV('alice', report, [settledBill, unsettledBill]);
    expect(csv).toContain('yes');
    expect(csv).toContain('no');
  });

  it('includes your share column with correct value', () => {
    const b = bill({ id: '1', totalAmount: 200 }); // alice owes 100
    const report = makeReport([b]);
    const csv = exportToCSV('alice', report, [b]);
    const dataRow = csv.split('\r\n')[1];
    expect(dataRow).toContain('100');
  });
});
