import { useState, useCallback } from 'react';

// Fields the parser can flag for user review.
export type FlaggedField = 'merchantName' | 'date' | 'items' | 'charges' | 'subtotal' | 'total';

export function useFlaggedFields(initialFlagged: string[]) {
  const [flagged, setFlagged] = useState<Set<FlaggedField>>(
    new Set(initialFlagged.filter((f): f is FlaggedField =>
      ['merchantName', 'date', 'items', 'charges', 'subtotal', 'total'].includes(f)
    ))
  );

  const confirm = useCallback((field: FlaggedField) => {
    setFlagged((prev) => {
      const next = new Set(prev);
      next.delete(field);
      return next;
    });
  }, []);

  const reset = useCallback((fields: string[]) => {
    setFlagged(new Set(fields.filter((f): f is FlaggedField =>
      ['merchantName', 'date', 'items', 'charges', 'subtotal', 'total'].includes(f)
    )));
  }, []);

  const isFlagged = useCallback((field: FlaggedField) => flagged.has(field), [flagged]);

  return { flagged, isFlagged, confirm, reset, flaggedCount: flagged.size };
}
