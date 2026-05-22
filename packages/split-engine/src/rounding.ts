/**
 * Money math helpers. Everything in this engine rounds at the boundary --
 * never mid-calculation -- so intermediate float drift can't compound.
 */

/** Round a number to 2 decimal places (cents). */
export function roundCents(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * Two cent-precision numbers are considered equal if they differ by < 0.005.
 * Used to avoid float comparison surprises like 0.1 + 0.2 !== 0.3.
 */
export function centsEqual(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.005;
}

/**
 * Round each entry to cents, then ensure the sum exactly equals
 * `expectedTotal`. Any leftover (positive or negative) is assigned to a
 * single deterministically-chosen recipient:
 *   1. the entry with the largest absolute value (so the relative impact
 *      of the rounding is smallest);
 *   2. ties broken by lexicographic key.
 *
 * This guarantees: sum(result.value) === expectedTotal (within cent precision).
 */
export function assignLeftover<T extends { key: string; value: number }>(
  entries: T[],
  expectedTotal: number,
): T[] {
  if (entries.length === 0) return entries;

  const rounded: T[] = entries.map((e) => ({ ...e, value: roundCents(e.value) }));
  const sum = roundCents(rounded.reduce((s, e) => s + e.value, 0));
  const drift = roundCents(expectedTotal - sum);

  if (Math.abs(drift) < 0.005) return rounded;

  let targetIdx = 0;
  for (let i = 1; i < rounded.length; i++) {
    const cur = Math.abs(rounded[i]!.value);
    const best = Math.abs(rounded[targetIdx]!.value);
    if (cur > best) {
      targetIdx = i;
    } else if (cur === best && rounded[i]!.key.localeCompare(rounded[targetIdx]!.key) < 0) {
      targetIdx = i;
    }
  }

  const updated = { ...rounded[targetIdx]!, value: roundCents(rounded[targetIdx]!.value + drift) };
  rounded[targetIdx] = updated;
  return rounded;
}
