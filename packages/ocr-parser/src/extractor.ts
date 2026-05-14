import type {
  ClassifiedLine,
  Country,
  BillType,
  ParsedBillDraft,
  ParsedItem,
  ParsedCharge,
  ItemCategory,
} from './types';
import { extractPrice } from './classifier';

// ─── Item category detection ──────────────────────────────────────────────────

const ALCOHOL_RE = /\b(beer|wine|whisky|whiskey|rum|vodka|gin|brandy|tequila|cocktail|mojito|spirits?|cider|lager|ale|kingfisher|corona|heineken)\b/i;
const NON_TAXABLE_RE = /\b(water|mineral\s*water|soda\s*water)\b/i;

function detectItemCategory(name: string): ItemCategory {
  if (ALCOHOL_RE.test(name)) return 'alcohol';
  if (NON_TAXABLE_RE.test(name)) return 'non_taxable';
  return 'food';
}

// ─── Quantity extraction ──────────────────────────────────────────────────────

// Unit suffixes used on Indian receipts: Pk (pack), Pcs (pieces), Nos, Kg, Gm, L, Ml
const UNIT_SUFFIX_RE = /^(\d+)\s*(pk|pcs?|nos?|kg|gm|g|ltr?|ml)\b/i;
const QTY_X_RE = /^(\d+)\s*[x×]\s*/i;

function extractQuantityAndName(text: string): { quantity: number; name: string } {
  // "9Pk PAROTTA" or "9Pk" embedded in cleaned name
  const unitMatch = text.match(UNIT_SUFFIX_RE);
  if (unitMatch) {
    return {
      quantity: parseInt(unitMatch[1], 10),
      name: text.slice(unitMatch[0].length).trim() || text.trim(),
    };
  }

  // "2x Naan" or "2 x Naan"
  const xPrefixMatch = text.match(QTY_X_RE);
  if (xPrefixMatch) {
    return {
      quantity: parseInt(xPrefixMatch[1], 10),
      name: text.slice(xPrefixMatch[0].length).trim(),
    };
  }

  // "Naan x2"
  const xSuffixMatch = text.match(/^(.+?)\s*[x×]\s*(\d+)\s*$/i);
  if (xSuffixMatch) {
    return {
      quantity: parseInt(xSuffixMatch[2], 10),
      name: xSuffixMatch[1].trim(),
    };
  }

  return { quantity: 1, name: text.trim() };
}

// Strip leading SI/serial number: "1 PAROTTA", "2 CHICKEN 65"
function stripSerialNumber(text: string): string {
  // Match a leading digit(s) followed by a space and then a letter — serial number
  return text.replace(/^\d+\s+(?=[A-Za-z])/, '').trim();
}

function cleanItemName(rawText: string, price: number): string {
  // Receipt rows from ML Kit arrive as one line: "Name  Qty  UnitPrice  TotalPrice"
  // Strip the trailing price (with or without currency symbol, integer or decimal).
  const priceStr = price.toString();
  const withSymbol = new RegExp(`\\s*[₹$]?\\s*${priceStr.replace('.', '\\.')}(?:\\.\\d{1,2})?\\s*$`);
  let cleaned = rawText.replace(withSymbol, '').trim();

  // Also strip any remaining trailing currency+price pattern not caught above
  cleaned = cleaned.replace(/\s*[₹$]\s*\d+(?:\.\d{1,2})?\s*$/, '').trim();

  // Strip trailing standalone numbers (qty, unit-price columns after price removed).
  cleaned = cleaned.replace(/(\s+\d+(?:\.\d{1,2})?)+$/, '').trim();

  return cleaned;
}

// ─── Charge label builders ────────────────────────────────────────────────────

// India: CGST and SGST always appear as a pair, same amount each.
// We aggregate them into a single GST charge for the split engine.
interface CgstSgstAccumulator {
  cgst: number | null;
  sgst: number | null;
  cgstLabel: string;
  sgstLabel: string;
}

function buildChargeType(label: string, country: Country): string {
  const l = label.toLowerCase();
  if (/cgst|sgst|igst|gst|vat/.test(l)) return 'sales_tax';
  if (/sales.?tax|state.?tax/.test(l)) return country === 'IN' ? 'sales_tax' : 'state_tax';
  // Plain "Tax:" or "Tax $X" on a US receipt = state sales tax
  if (/^tax[\s:$₹\d.,]*$/.test(l.trim())) return country === 'US' ? 'state_tax' : 'sales_tax';
  if (/city.?tax/.test(l)) return 'city_tax';
  if (/delivery/.test(l)) return 'delivery_fee';
  if (/platform/.test(l)) return 'platform_fee';
  if (/service.?fee|convenience/.test(l)) return 'service_fee';
  if (/packing|packaging|container/.test(l)) return 'service_fee';
  if (/tip|gratuity|service.?charge/.test(l)) return 'gratuity';
  if (/discount|promo|coupon|off\b|savings?|cashback/.test(l)) return 'discount';
  return 'custom';
}

// ─── GST rate extraction ──────────────────────────────────────────────────────

const RATE_RE = /@\s*(\d+(?:\.\d+)?)\s*%/;

function extractRate(label: string): number | undefined {
  const match = label.match(RATE_RE);
  if (!match) return undefined;
  return parseFloat(match[1]) / 100;
}

// ─── Main extractor ───────────────────────────────────────────────────────────

export function extractFields(
  lines: ClassifiedLine[],
  country: Country,
  billType: BillType
): ParsedBillDraft {
  const items: ParsedItem[] = [];
  const charges: ParsedCharge[] = [];

  let merchantName: string | null = null;
  let date: string | null = null;
  let subtotal: number | null = null;
  let total: number | null = null;

  // Confidence trackers — we track per-field confidence separately
  const conf = {
    merchantName: 0,
    date: 0,
    items: 0,
    charges: 0,
    subtotal: 0,
    total: 0,
  };

  // India: accumulate CGST/SGST to merge into one GST charge
  const gstAccum: CgstSgstAccumulator = {
    cgst: null,
    sgst: null,
    cgstLabel: '',
    sgstLabel: '',
  };

  for (const cl of lines) {
    const text = cl.raw.text.trim();

    switch (cl.lineType) {
      case 'merchant_name': {
        if (!merchantName) {
          merchantName = text;
          conf.merchantName = cl.confidence;
        }
        break;
      }

      case 'date': {
        if (!date) {
          date = parseDate(text);
          conf.date = date ? cl.confidence : 0.2;
        }
        break;
      }

      case 'item': {
        const price = extractPrice(text);
        if (price === null) break;

        const nameRaw = stripSerialNumber(cleanItemName(text, price));
        const { quantity, name } = extractQuantityAndName(nameRaw);
        const unitPrice = quantity > 1 ? price / quantity : price;
        const category = detectItemCategory(name);

        items.push({
          name,
          quantity,
          unitPrice: round2(unitPrice),
          totalPrice: round2(price),
          category,
          confidence: cl.confidence,
        });

        // Item field confidence = average of all item line confidences
        conf.items = average(items.map((i) => i.confidence));
        break;
      }

      case 'tax_line': {
        const amount = extractPrice(text);
        if (amount === null) break;

        const label = text;
        const rate = extractRate(label);

        // India: separate CGST and SGST, merge them
        if (country === 'IN' && /cgst/i.test(label)) {
          gstAccum.cgst = amount;
          gstAccum.cgstLabel = label;
          break;
        }
        if (country === 'IN' && /sgst/i.test(label)) {
          gstAccum.sgst = amount;
          gstAccum.sgstLabel = label;
          break;
        }

        charges.push({
          type: buildChargeType(label, country),
          label: cleanChargeLabel(label, amount),
          amount: round2(amount),
          rate,
          confidence: cl.confidence,
        });

        conf.charges = average(charges.map((c) => c.confidence));
        break;
      }

      case 'fee_line': {
        const amount = extractPrice(text);
        if (amount === null) break;

        charges.push({
          type: buildChargeType(text, country),
          label: cleanChargeLabel(text, amount),
          amount: round2(amount),
          confidence: cl.confidence,
        });

        conf.charges = average(charges.map((c) => c.confidence));
        break;
      }

      case 'tip': {
        const amount = extractPrice(text);
        if (amount === null) break;

        const label = country === 'IN' ? 'Service Charge' : 'Tip';
        const rate = extractRate(text);

        charges.push({
          type: 'gratuity',
          label,
          amount: round2(amount),
          rate,
          confidence: cl.confidence,
        });

        conf.charges = average(charges.map((c) => c.confidence));
        break;
      }

      case 'discount': {
        const rawAmount = extractPrice(text);
        if (rawAmount === null) break;

        charges.push({
          type: 'discount',
          label: cleanChargeLabel(text, rawAmount),
          amount: round2(-Math.abs(rawAmount)), // always negative
          confidence: cl.confidence,
        });

        conf.charges = average(charges.map((c) => c.confidence));
        break;
      }

      case 'subtotal': {
        const amount = extractPrice(text);
        if (amount !== null) {
          subtotal = round2(amount);
          conf.subtotal = cl.confidence;
        }
        break;
      }

      case 'total': {
        const amount = extractPrice(text);
        if (amount !== null) {
          total = round2(amount);
          conf.total = cl.confidence;
        }
        break;
      }

      case 'noise':
        break;
    }
  }

  // ─── Merge CGST + SGST into one GST charge (India) ───────────────────────
  if (country === 'IN' && (gstAccum.cgst !== null || gstAccum.sgst !== null)) {
    const cgst = gstAccum.cgst ?? 0;
    const sgst = gstAccum.sgst ?? 0;
    const totalGst = round2(cgst + sgst);
    const rate = extractRate(gstAccum.cgstLabel) ?? extractRate(gstAccum.sgstLabel);

    // Label: extract the rate % if present
    const rateStr = rate ? ` @ ${(rate * 2 * 100).toFixed(1)}%` : '';
    charges.push({
      type: 'sales_tax',
      label: `GST${rateStr}`,
      amount: totalGst,
      rate: rate ? round4(rate * 2) : undefined,
      confidence: 0.93, // CGST/SGST keywords are very reliable
    });

    conf.charges = average(charges.map((c) => c.confidence));
  }

  // ─── Infer subtotal if missing ────────────────────────────────────────────
  if (subtotal === null && items.length > 0) {
    subtotal = round2(items.reduce((s, i) => s + i.totalPrice, 0));
    conf.subtotal = 0.65; // inferred, lower confidence
  }

  // ─── GST-inclusive detection (India) ─────────────────────────────────────
  // If item subtotal ≈ total, there's no room for additional tax charges.
  // This means GST is already baked into item prices (MRP-inclusive).
  // Mark those tax charges as gstInclusive so the split engine doesn't add them again.
  if (country === 'IN' && subtotal !== null && total !== null) {
    const taxChargeTotal = round2(
      charges.filter((c) => c.type === 'sales_tax').reduce((s, c) => s + c.amount, 0)
    );
    const itemsAlreadyCoverTotal = Math.abs(subtotal - total) < 1.00;
    if (itemsAlreadyCoverTotal && taxChargeTotal > 0) {
      for (const charge of charges) {
        if (charge.type === 'sales_tax') {
          charge.gstInclusive = true;
        }
      }
      // Lower charge confidence — user must confirm inclusive vs additive
      conf.charges = Math.min(conf.charges, 0.65);
    }
  }

  // ─── Infer total when missing ─────────────────────────────────────────────
  // Some receipts (UberEats) show subtotal + individual charges but no Grand Total line.
  // Compute total from subtotal + all additive charges.
  if (total === null && subtotal !== null && charges.length > 0) {
    const additiveCharges = charges
      .filter((c) => !c.gstInclusive)
      .reduce((s, c) => s + c.amount, 0);
    total = round2(subtotal + additiveCharges);
    conf.total = 0.70; // inferred, lower than explicit total (0.92)
  }

  // ─── Bill type context: delivery bills always have a delivery fee ─────────
  if (billType === 'delivery' && !charges.some((c) => c.type === 'delivery_fee')) {
    conf.charges = Math.min(conf.charges, 0.60);
  }

  const flaggedFields: string[] = []; // populated by parser.ts after threshold check

  return {
    country,
    billType,
    merchantName,
    date,
    items,
    charges,
    subtotal,
    total,
    confidenceScores: conf,
    flaggedFields,
  };
}

// ─── Utility helpers ──────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function average(nums: number[]): number {
  if (nums.length === 0) return 0;
  return round2(nums.reduce((a, b) => a + b, 0) / nums.length);
}

function cleanChargeLabel(text: string, _amount: number): string {
  // Remove trailing price (any format: 30, 30.00, ₹30, $30.00)
  return text
    .replace(/\s*[₹$]?\s*\d{1,6}(?:[.,]\d{1,2})?\s*$/, '')
    .replace(/[-:]\s*$/, '')   // strip trailing colon or dash
    .trim();
}

// Normalise various date formats to YYYY-MM-DD
function parseDate(text: string): string | null {
  // YYYY-MM-DD or YYYY/MM/DD
  const isoMatch = text.match(/(\d{4})[\/\-\.](\d{1,2})[\/\-\.](\d{1,2})/);
  if (isoMatch) {
    const [, y, m, d] = isoMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // DD/MM/YYYY or DD-MM-YYYY (4-digit year)
  const dmyMatch = text.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{4})/);
  if (dmyMatch) {
    const [, d, m, y] = dmyMatch;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // DD/MM/YY — 2-digit year, normalise to 20xx
  const dmyShortMatch = text.match(/(\d{1,2})[\/\-\.](\d{1,2})[\/\-\.](\d{2})\b/);
  if (dmyShortMatch) {
    const [, d, m, yy] = dmyShortMatch;
    const y = `20${yy}`;
    return `${y}-${m.padStart(2, '0')}-${d.padStart(2, '0')}`;
  }

  // DD Mon YYYY
  const months: Record<string, string> = {
    jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
    jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };
  const writtenMatch = text.match(/(\d{1,2})\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+(\d{4})/i);
  if (writtenMatch) {
    const [, d, mon, y] = writtenMatch;
    return `${y}-${months[mon.toLowerCase()]}-${d.padStart(2, '0')}`;
  }

  return null;
}
