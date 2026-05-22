import type { ItemCategory } from '@splitmate/types';

/**
 * Heuristic item-name categorizer. Maps a line-item name (as extracted
 * from OCR text) into one of the four categories the split engine uses
 * for tax allocation:
 *
 *   food          – normal menu items, prepared food
 *   alcohol       – beer, wine, spirits, cocktails
 *   non_taxable   – bottled water, some grocery staples, medicine-adjacent
 *   other         – anything we can't confidently classify
 *
 * The match is case-insensitive and uses keyword lists. When no keyword
 * matches, we default to 'food' if the item looks like a typical menu
 * item (has no obvious non-food signal), otherwise 'other'.
 */

const ALCOHOL_KEYWORDS = [
  'beer', 'lager', 'ale', 'ipa', 'stout', 'porter',
  'wine', 'merlot', 'chardonnay', 'sauvignon', 'pinot', 'cabernet', 'rosé', 'rose',
  'champagne', 'prosecco', 'sparkling wine',
  'cocktail', 'martini', 'margarita', 'mojito', 'daiquiri', 'sangria',
  'whiskey', 'whisky', 'bourbon', 'scotch', 'rum', 'vodka', 'gin', 'tequila',
  'brandy', 'cognac', 'sake', 'soju',
  'hard seltzer', 'hard cider', 'malt',
  'bud light', 'budweiser', 'heineken', 'corona', 'stella',
  'kingfisher', 'tuborg', 'carlsberg', 'old monk',
];

const NON_TAXABLE_KEYWORDS = [
  'water', 'bottled water', 'spring water',
  'medicine', 'antacid', 'aspirin', 'ibuprofen',
  'milk', 'bread', 'rice', 'flour', 'eggs',
];

const NON_FOOD_SIGNALS = [
  'service', 'charge', 'fee', 'tax', 'tip', 'gratuity',
  'delivery', 'platform', 'surge', 'bag', 'container',
  'subtotal', 'total', 'balance', 'change', 'payment',
  'visa', 'mastercard', 'amex', 'cash',
];

export function categorizeItem(name: string): ItemCategory {
  const lower = name.toLowerCase().trim();
  if (!lower) return 'other';

  // Check alcohol first (most specific)
  for (const kw of ALCOHOL_KEYWORDS) {
    if (lower.includes(kw)) return 'alcohol';
  }

  // Non-taxable
  for (const kw of NON_TAXABLE_KEYWORDS) {
    if (lower.includes(kw)) return 'non_taxable';
  }

  // If it looks like a fee/charge/payment line, it's not a food item
  for (const signal of NON_FOOD_SIGNALS) {
    if (lower.includes(signal)) return 'other';
  }

  // Default: assume it's food (most menu items are)
  return 'food';
}
