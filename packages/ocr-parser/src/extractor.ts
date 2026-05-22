import type { BillType, Country, ChargeType } from '@splitmate/types';
import type { ClassifiedLine } from './classifier';
import { categorizeItem } from './categorize';
import {
  extractInrAmount, isCgstLine, isSgstLine,
} from './countries/in';
import { extractUsDollarAmount } from './countries/us';

/**
 * Intermediate representation between classifier output and the final
 * ParsedBillDraft. The parser (parser.ts) consumes this and adds
 * confidence scoring + flagged fields.
 */
export type ExtractedFields = {
  merchant: string | null;
  date: string | null;
  currency: string;
  items: ExtractedItem[];
  charges: ExtractedCharge[];
  subtotal: number | null;
  total: number | null;
  rawText: string;
};

export type ExtractedItem = {
  name: string;
  quantity: number;
  unitPrice: number;
  totalPrice: number;
  category: ReturnType<typeof categorizeItem>;
};

export type ExtractedCharge = {
  type: ChargeType;
  label: string;
  amount: number;
  rate: number | undefined;
  /** CGST/SGST lines should be aggregated into a single GST charge. */
  isCgst?: boolean;
  isSgst?: boolean;
};

// ---------------------------------------------------------------------------
// Amount extractor dispatch
// ---------------------------------------------------------------------------

function extractAmount(text: string, country: Country): number | null {
  return country === 'IN' ? extractInrAmount(text) : extractUsDollarAmount(text);
}

// ---------------------------------------------------------------------------
// Date extraction
// ---------------------------------------------------------------------------

const DATE_REGEX_VARIANTS = [
  // MM/DD/YYYY or DD/MM/YYYY — we prefer MM/DD for US, DD/MM for IN
  /(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/,
  // YYYY-MM-DD (ISO)
  /(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/,
  // "Jan 15, 2026" etc.
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*[\s.]+(\d{1,2})[,.]?\s*(\d{2,4})/i,
];

const MONTH_MAP: Record<string, string> = {
  jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
  jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
};

function extractDate(text: string, country: Country): string | null {
  for (const rx of DATE_REGEX_VARIANTS) {
    const m = text.match(rx);
    if (!m) continue;

    // Named month
    const monthKey = m[1]?.toLowerCase().slice(0, 3);
    if (monthKey && MONTH_MAP[monthKey]) {
      const month = MONTH_MAP[monthKey]!;
      const day = (m[2] ?? '1').padStart(2, '0');
      let year = m[3] ?? '';
      if (year.length === 2) year = `20${year}`;
      return `${year}-${month}-${day}`;
    }

    // Numeric
    const p1 = parseInt(m[1] ?? '0', 10);
    const p2 = parseInt(m[2] ?? '0', 10);
    const p3 = parseInt(m[3] ?? '0', 10);

    // YYYY-MM-DD
    if (p1 > 1000) {
      const month = String(p2).padStart(2, '0');
      const day = String(p3).padStart(2, '0');
      return `${p1}-${month}-${day}`;
    }

    // US: MM/DD/YYYY, IN: DD/MM/YYYY
    let year = p3 < 100 ? 2000 + p3 : p3;
    if (country === 'US') {
      return `${year}-${String(p1).padStart(2, '0')}-${String(p2).padStart(2, '0')}`;
    } else {
      return `${year}-${String(p2).padStart(2, '0')}-${String(p1).padStart(2, '0')}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Item extraction
// ---------------------------------------------------------------------------

/**
 * Parse an item line into name + quantity + price. OCR item lines look like:
 *   "2x Margherita Pizza $24.00"
 *   "Naan ₹80"
 *   "1 Chicken Biryani 350.00"
 *   "Avocado Toast        $16.50"
 *
 * Strategy: find the rightmost price, everything to its left is the name
 * (with an optional leading quantity like "2x" or "2 ").
 */
function extractItem(text: string, country: Country): ExtractedItem | null {
  const amount = extractAmount(text, country);
  if (amount == null || amount <= 0) return null;

  // Remove the price portion to isolate the name
  let namePart = text;
  // Remove currency symbol and trailing price
  namePart = namePart
    .replace(/[$₹]?\s*\d+[.,]\d{0,2}\s*$/, '')
    .replace(/\bRs\.?\s*\d+[.,]?\d{0,2}/i, '')
    .trim();

  // Extract leading quantity: "2x ", "2 x ", "3 "
  let quantity = 1;
  const qtyMatch = namePart.match(/^(\d+)\s*[xX×]?\s+/);
  if (qtyMatch?.[1]) {
    quantity = parseInt(qtyMatch[1], 10) || 1;
    namePart = namePart.slice(qtyMatch[0].length).trim();
  }

  if (!namePart) return null;

  const unitPrice = quantity > 0 ? Math.round((amount / quantity) * 100) / 100 : amount;
  const totalPrice = amount;

  return {
    name: namePart,
    quantity,
    unitPrice,
    totalPrice,
    category: categorizeItem(namePart),
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function extractFields(
  lines: ClassifiedLine[],
  country: Country,
  _billType: BillType,
): ExtractedFields {
  const currency = country === 'IN' ? 'INR' : 'USD';
  const rawText = lines.map((l) => l.text).join('\n');

  let merchant: string | null = null;
  let date: string | null = null;
  let subtotal: number | null = null;
  let total: number | null = null;
  const items: ExtractedItem[] = [];
  const charges: ExtractedCharge[] = [];

  for (const line of lines) {
    switch (line.lineType) {
      case 'merchant':
        // Take the first merchant line (or concatenate if multi-line)
        merchant = merchant ? `${merchant} ${line.text.trim()}` : line.text.trim();
        break;

      case 'date': {
        if (!date) {
          date = extractDate(line.text, country);
        }
        break;
      }

      case 'item': {
        const item = extractItem(line.text, country);
        if (item) items.push(item);
        break;
      }

      case 'subtotal': {
        const amt = extractAmount(line.text, country);
        if (amt != null) subtotal = Math.abs(amt);
        break;
      }

      case 'total': {
        const amt = extractAmount(line.text, country);
        if (amt != null) total = Math.abs(amt);
        break;
      }

      case 'tax_line': {
        const amt = extractAmount(line.text, country);
        if (amt != null) {
          charges.push({
            type: 'tax',
            label: line.text.trim(),
            amount: Math.abs(amt),
            rate: undefined,
            isCgst: isCgstLine(line.text),
            isSgst: isSgstLine(line.text),
          });
        }
        break;
      }

      case 'tip': {
        const amt = extractAmount(line.text, country);
        if (amt != null) {
          charges.push({ type: 'tip', label: 'Tip', amount: Math.abs(amt), rate: undefined });
        }
        break;
      }

      case 'service': {
        const amt = extractAmount(line.text, country);
        if (amt != null) {
          charges.push({
            type: 'service', label: 'Service charge', amount: Math.abs(amt), rate: undefined,
          });
        }
        break;
      }

      case 'delivery': {
        const amt = extractAmount(line.text, country);
        if (amt != null) {
          charges.push({
            type: 'delivery', label: line.text.trim(), amount: Math.abs(amt), rate: undefined,
          });
        }
        break;
      }

      case 'platform': {
        const amt = extractAmount(line.text, country);
        if (amt != null) {
          charges.push({
            type: 'platform', label: 'Platform fee', amount: Math.abs(amt), rate: undefined,
          });
        }
        break;
      }

      case 'surge': {
        const amt = extractAmount(line.text, country);
        if (amt != null) {
          charges.push({
            type: 'surge', label: 'Surge fee', amount: Math.abs(amt), rate: undefined,
          });
        }
        break;
      }

      case 'discount': {
        const amt = extractAmount(line.text, country);
        if (amt != null) {
          charges.push({
            type: 'discount',
            label: line.text.trim(),
            amount: -Math.abs(amt), // discounts are always negative
            rate: undefined,
          });
        }
        break;
      }

      case 'noise':
        break;
    }
  }

  // India: aggregate CGST + SGST into a single GST charge
  if (country === 'IN') {
    const cgst = charges.filter((c) => c.isCgst);
    const sgst = charges.filter((c) => c.isSgst);
    if (cgst.length > 0 && sgst.length > 0) {
      const gstTotal = [...cgst, ...sgst].reduce((s, c) => s + c.amount, 0);
      // Remove individual CGST/SGST, add combined GST
      const remaining = charges.filter((c) => !c.isCgst && !c.isSgst);
      remaining.push({
        type: 'tax',
        label: 'GST',
        amount: Math.round(gstTotal * 100) / 100,
        rate: undefined,
      });
      charges.length = 0;
      charges.push(...remaining);
    }
  }

  // Clean up internal-only flags
  for (const c of charges) {
    delete (c as Record<string, unknown>)['isCgst'];
    delete (c as Record<string, unknown>)['isSgst'];
  }

  return { merchant, date, currency, items, charges, subtotal, total, rawText };
}
