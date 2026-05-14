import type { BillRecord, SpendingPersonality } from './types';

// Minimum bills required before we'll derive a personality.
// Below this threshold we don't have enough signal to be meaningful.
export const MIN_BILLS_FOR_PERSONALITY = 5;

// Derives a spending personality from a user's lifetime bill history.
// Returns null if fewer than MIN_BILLS_FOR_PERSONALITY bills exist.
export function derivePersonality(
  _userId: string,
  _bills: BillRecord[]
): SpendingPersonality | null {
  throw new Error('not implemented');
}
