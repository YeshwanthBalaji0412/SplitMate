import type { BillRecord } from './types';

/**
 * Export bill records to JSON or CSV (RFC 4180). The caller writes the
 * result to the filesystem / shares it via expo-sharing. This module
 * does the serialization only — no file I/O.
 */

export function exportToJSON(records: BillRecord[]): string {
  return JSON.stringify(records, null, 2);
}

export function importFromJSON(json: string): BillRecord[] {
  const parsed = JSON.parse(json);
  if (!Array.isArray(parsed)) throw new Error('Expected a JSON array of BillRecord objects');
  return parsed as BillRecord[];
}

/**
 * RFC 4180 CSV. Columns:
 *   id, date, title, billType, totalAmount, currency, status, settledAt,
 *   participantCount, yourOwedAmount
 *
 * `userId` is required to compute "yourOwedAmount".
 */
export function exportToCSV(records: BillRecord[], userId: string): string {
  const HEADER =
    'id,date,title,billType,totalAmount,currency,status,settledAt,participantCount,yourOwedAmount';
  const rows = records.map((r) => {
    const myShare = r.participants.find((p) => p.userId === userId);
    return [
      csvEscape(r.id),
      csvEscape(r.date),
      csvEscape(r.title),
      csvEscape(r.billType),
      r.totalAmount.toFixed(2),
      csvEscape(r.currency),
      csvEscape(r.status),
      csvEscape(r.settledAt ?? ''),
      r.participants.length,
      (myShare?.owedAmount ?? 0).toFixed(2),
    ].join(',');
  });
  return [HEADER, ...rows].join('\r\n') + '\r\n';
}

function csvEscape(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}
