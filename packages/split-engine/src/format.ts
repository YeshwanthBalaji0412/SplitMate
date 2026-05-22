/**
 * Country-aware currency formatting. Symbols cover the two MVP currencies
 * (USD + INR); everything else falls back to `12.34 ABC`.
 */
const SYMBOLS: Record<string, string> = {
  USD: '$',
  INR: '₹',
};

export function formatAmount(value: number, currency: string): string {
  const code = currency.toUpperCase();
  const symbol = SYMBOLS[code];
  const abs = Math.abs(value).toFixed(2);
  const sign = value < 0 ? '-' : '';
  if (symbol) return `${sign}${symbol}${abs}`;
  return `${sign}${abs} ${code}`;
}
