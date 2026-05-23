import { describe, it, expect } from 'vitest';
import { exportToJSON, exportToCSV, importFromJSON } from '../src/exporter';
import { makeBill } from './helpers';

describe('exporter', () => {
  it('1. exportToJSON returns valid JSON array', () => {
    const bills = [makeBill({ id: 'b1' }), makeBill({ id: 'b2' })];
    const json = exportToJSON(bills);
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].id).toBe('b1');
  });

  it('2. importFromJSON round-trips with exportToJSON', () => {
    const bills = [makeBill({ id: 'b1', title: 'Dinner' })];
    const json = exportToJSON(bills);
    const imported = importFromJSON(json);
    expect(imported).toHaveLength(1);
    expect(imported[0]!.title).toBe('Dinner');
  });

  it('3. importFromJSON throws on non-array', () => {
    expect(() => importFromJSON('{"not":"array"}')).toThrow('Expected a JSON array');
  });

  it('4. exportToCSV starts with header row', () => {
    const bills = [makeBill({ id: 'b1' })];
    const csv = exportToCSV(bills, 'u1');
    const lines = csv.split('\r\n');
    expect(lines[0]).toContain('id,date,title,billType');
  });

  it('5. exportToCSV has correct number of data rows', () => {
    const bills = [makeBill({ id: 'b1' }), makeBill({ id: 'b2' }), makeBill({ id: 'b3' })];
    const csv = exportToCSV(bills, 'u1');
    const lines = csv.split('\r\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(4); // header + 3 data
  });

  it('6. exportToCSV includes yourOwedAmount for the user', () => {
    const bill = makeBill({
      id: 'b1',
      participants: [
        { userId: 'u1', owedAmount: 42.5, paidAmount: 0 },
        { userId: 'u2', owedAmount: 57.5, paidAmount: 0 },
      ],
    });
    const csv = exportToCSV([bill], 'u1');
    expect(csv).toContain('42.50');
  });

  it('7. CSV escapes commas in title', () => {
    const bill = makeBill({ id: 'b1', title: 'Dinner, drinks, and dessert' });
    const csv = exportToCSV([bill], 'u1');
    expect(csv).toContain('"Dinner, drinks, and dessert"');
  });

  it('8. empty records produce header-only CSV', () => {
    const csv = exportToCSV([], 'u1');
    const lines = csv.split('\r\n').filter((l) => l.length > 0);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('id,date');
  });
});
