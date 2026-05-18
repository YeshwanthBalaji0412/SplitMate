import type { MonthlyReport, BillRecord, AnalyticsExport } from './types';

export function exportToJSON(
  userId: string,
  report: MonthlyReport,
  bills: BillRecord[]
): string {
  const payload: AnalyticsExport = {
    generatedAt: new Date().toISOString(),
    userId,
    report,
    rawTotals: { bills },
  };
  return JSON.stringify(payload, null, 2);
}

function csvCell(value: string | number): string {
  const str = String(value);
  // RFC 4180: quote if value contains comma, double-quote, or newline
  if (/[",\r\n]/.test(str)) return `"${str.replace(/"/g, '""')}"`;
  return str;
}

export function exportToCSV(
  userId: string,
  _report: MonthlyReport,
  bills: BillRecord[]
): string {
  const userBills = bills.filter((b) =>
    b.participants.some((p) => p.userId === userId)
  );

  const header = ['date', 'group_id', 'bill_type', 'your_share', 'total_amount', 'currency', 'settled'];
  const rows = userBills.map((b) => {
    const share = b.participants.find((p) => p.userId === userId)?.owedAmount ?? 0;
    return [
      csvCell(b.date),
      csvCell(b.groupId),
      csvCell(b.billType),
      csvCell(share),
      csvCell(b.totalAmount),
      csvCell(b.currency),
      csvCell(b.settledAt ? 'yes' : 'no'),
    ].join(',');
  });

  return [header.join(','), ...rows].join('\r\n');
}

export function importFromJSON(json: string): AnalyticsExport {
  return JSON.parse(json) as AnalyticsExport;
}
