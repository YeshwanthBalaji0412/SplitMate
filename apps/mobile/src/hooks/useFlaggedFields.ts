import { useCallback, useState } from 'react';

/**
 * Tracks which OCR-parsed fields are flagged for user review and provides
 * helpers to confirm (unflag) them.
 *
 * Usage:
 *   const { isFlagged, confirm, confirmAll, remaining, reset } = useFlaggedFields(draft.flaggedFields);
 *
 *   isFlagged('total')        // → boolean
 *   isFlagged('items[2].name') // → boolean
 *   confirm('total')           // removes 'total' from the set
 *   confirmAll()               // clears all remaining flags
 *   remaining                  // number of unconfirmed flags
 *
 * When `remaining === 0`, the badge should show "✓ All fields confirmed".
 */
export function useFlaggedFields(initialFields: string[] = []) {
  const [flagged, setFlagged] = useState<Set<string>>(() => new Set(initialFields));

  const isFlagged = useCallback(
    (field: string) => flagged.has(field),
    [flagged],
  );

  /** Confirm a specific field (remove its flag). Called when the user edits it. */
  const confirm = useCallback((field: string) => {
    setFlagged((prev) => {
      if (!prev.has(field)) return prev;
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
  }, []);

  /** Confirm all remaining flagged fields at once. */
  const confirmAll = useCallback(() => {
    setFlagged(new Set());
  }, []);

  /** Re-seed the flag set from a new scan result. */
  const reset = useCallback((fields: string[]) => {
    setFlagged(new Set(fields));
  }, []);

  return {
    isFlagged,
    confirm,
    confirmAll,
    reset,
    remaining: flagged.size,
    /** The full set, for serializing into parse_metadata. */
    flaggedSet: flagged,
  };
}
