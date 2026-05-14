/**
 * Split Calculation Engine — deterministic, rule-based, fully testable.
 *
 * Design principles:
 * - No randomness, no ML — every output is reproducible from the same inputs.
 * - Works in plain JS numbers (64-bit float). Round only at the final output
 *   step. Any rounding remainder is absorbed by the largest-owed participant
 *   to guarantee sum == totalAmount.
 * - Each calculation stage is a pure function so individual stages can be
 *   unit-tested in isolation.
 */

import type {
  SplitInput,
  SplitResult,
  PersonBreakdown,
  ChargeComponent,
  LineItem,
  LineItemParticipant,
  ExpenseParticipant,
} from '@split-smart/types';

export interface SplitEngineOptions {
  /** Number of decimal places to round final per-person amounts to. Default: 2 */
  precision?: number;
}

// ─── Stage helpers ────────────────────────────────────────────────────────────

/**
 * Stage 1 + 2: Build a map of userId → item subtotal.
 * For itemized splits each person's subtotal = sum of (unitPrice * their share proportion).
 * For non-itemized splits every included participant gets an equal share of the total subtotal.
 */
function computeItemSubtotals(
  lineItems: LineItem[],
  lineItemParticipants: LineItemParticipant[],
  participants: ExpenseParticipant[]
): Map<string, number> {
  const subtotals = new Map<string, number>();
  const includedIds = participants.filter((p) => p.isIncluded).map((p) => p.userId);

  if (lineItems.length === 0) {
    // No line items — subtotals are zero; charge components will drive allocation.
    for (const uid of includedIds) subtotals.set(uid, 0);
    return subtotals;
  }

  for (const uid of includedIds) subtotals.set(uid, 0);

  for (const item of lineItems) {
    const itemParticipants = lineItemParticipants.filter((lp) => lp.lineItemId === item.id);

    if (itemParticipants.length === 0) {
      // Item not assigned to anyone — split equally among all included participants.
      const share = item.totalPrice / includedIds.length;
      for (const uid of includedIds) {
        subtotals.set(uid, (subtotals.get(uid) ?? 0) + share);
      }
    } else {
      const totalShares = itemParticipants.reduce((sum, lp) => sum + lp.shares, 0);
      for (const lp of itemParticipants) {
        const share = (item.totalPrice * lp.shares) / totalShares;
        subtotals.set(lp.userId, (subtotals.get(lp.userId) ?? 0) + share);
      }
    }
  }

  return subtotals;
}

/**
 * Stage 3: Distribute a charge component among participants according to
 * its allocation rule. Returns a map of userId → charge amount.
 */
function distributeCharge(
  charge: ChargeComponent,
  participants: ExpenseParticipant[],
  subtotals: Map<string, number>
): Map<string, number> {
  const result = new Map<string, number>();
  const eligibleParticipants = participants.filter(
    (p) => p.isIncluded && !charge.excludedUserIds.includes(p.userId)
  );

  if (eligibleParticipants.length === 0) return result;

  switch (charge.allocationRule) {
    case 'equal': {
      const share = charge.amount / eligibleParticipants.length;
      for (const p of eligibleParticipants) result.set(p.userId, share);
      break;
    }

    case 'proportional_to_subtotal': {
      const totalSubtotal = eligibleParticipants.reduce(
        (sum, p) => sum + (subtotals.get(p.userId) ?? 0),
        0
      );
      if (totalSubtotal === 0) {
        // Fall back to equal if everyone has $0 subtotal.
        const share = charge.amount / eligibleParticipants.length;
        for (const p of eligibleParticipants) result.set(p.userId, share);
      } else {
        for (const p of eligibleParticipants) {
          const ratio = (subtotals.get(p.userId) ?? 0) / totalSubtotal;
          result.set(p.userId, charge.amount * ratio);
        }
      }
      break;
    }

    case 'proportional_to_selected_items': {
      // Same as proportional_to_subtotal but only the items that have this
      // charge applied (identified by excludedUserIds logic — future: link
      // charges to specific line items). For now behaves like subtotal.
      const totalSubtotal = eligibleParticipants.reduce(
        (sum, p) => sum + (subtotals.get(p.userId) ?? 0),
        0
      );
      if (totalSubtotal === 0) {
        const share = charge.amount / eligibleParticipants.length;
        for (const p of eligibleParticipants) result.set(p.userId, share);
      } else {
        for (const p of eligibleParticipants) {
          const ratio = (subtotals.get(p.userId) ?? 0) / totalSubtotal;
          result.set(p.userId, charge.amount * ratio);
        }
      }
      break;
    }

    case 'custom_fixed_amount': {
      // The charge.amount is the total; overrides per user are not stored in
      // ChargeComponent itself. For now split equally (callers handle overrides
      // by setting per-person ChargeComponents instead).
      const share = charge.amount / eligibleParticipants.length;
      for (const p of eligibleParticipants) result.set(p.userId, share);
      break;
    }

    case 'excluded': {
      // Charge is absorbed by the merchant / nobody pays.
      break;
    }
  }

  return result;
}

// ─── Main entry point ─────────────────────────────────────────────────────────

export function computeSplit(
  input: SplitInput,
  options: SplitEngineOptions = {}
): SplitResult {
  const { expense, lineItems, lineItemParticipants, chargeComponents, participants } = input;
  const precision = options.precision ?? 2;
  const factor = Math.pow(10, precision);

  // Stage 1+2: per-person item subtotals
  const subtotals = computeItemSubtotals(lineItems, lineItemParticipants, participants);

  // Accumulator: userId → running total owed
  const runningTotal = new Map<string, number>();
  for (const [uid, subtotal] of subtotals) runningTotal.set(uid, subtotal);

  // Stage 3: charge breakdowns per person
  // chargeBreakdownMap: userId → list of per-charge amounts
  const chargeBreakdownMap = new Map<string, PersonBreakdown['chargeBreakdown']>();
  for (const uid of subtotals.keys()) chargeBreakdownMap.set(uid, []);

  // Sort charges by position to maintain consistent application order
  const sortedCharges = [...chargeComponents].sort((a, b) => a.position - b.position);

  for (const charge of sortedCharges) {
    if (charge.type === 'subtotal') continue; // subtotal is handled above

    const distribution = distributeCharge(charge, participants, subtotals);

    for (const [uid, amount] of distribution) {
      // Discounts are negative
      const signed = charge.type === 'discount' ? -Math.abs(amount) : amount;
      runningTotal.set(uid, (runningTotal.get(uid) ?? 0) + signed);
      chargeBreakdownMap.get(uid)?.push({
        chargeId: charge.id,
        label: charge.label,
        type: charge.type,
        amount: signed,
      });
    }
  }

  // Stage 4: round to precision, absorb rounding remainder into max-ower
  let runningSum = 0;
  const rounded = new Map<string, number>();
  for (const [uid, amount] of runningTotal) {
    const r = Math.round(amount * factor) / factor;
    rounded.set(uid, r);
    runningSum += r;
  }

  const remainder = Math.round((expense.totalAmount - runningSum) * factor) / factor;

  // Absorb remainder into the participant with the highest owed amount
  if (remainder !== 0 && rounded.size > 0) {
    let maxUid = '';
    let maxAmount = -Infinity;
    for (const [uid, amount] of rounded) {
      if (amount > maxAmount) {
        maxAmount = amount;
        maxUid = uid;
      }
    }
    rounded.set(maxUid, Math.round((rounded.get(maxUid)! + remainder) * factor) / factor);
  }

  // Stage 5: build breakdown output
  const breakdown: PersonBreakdown[] = [];
  for (const participant of participants.filter((p) => p.isIncluded)) {
    const uid = participant.userId;
    const totalOwed = rounded.get(uid) ?? 0;
    const itemSubtotal = Math.round((subtotals.get(uid) ?? 0) * factor) / factor;
    const chargeBreakdown = chargeBreakdownMap.get(uid) ?? [];

    const explanation = buildExplanation(itemSubtotal, chargeBreakdown, totalOwed, expense.currency);

    breakdown.push({ userId: uid, itemSubtotal, chargeBreakdown, totalOwed, explanation });
  }

  // Stage 6: settlement graph (raw debts before minimization)
  // paidBy paid the whole bill; everyone else owes them their share
  const settlementGraph = breakdown
    .filter((b) => b.userId !== expense.paidBy && b.totalOwed > 0)
    .map((b) => ({
      fromUserId: b.userId,
      toUserId: expense.paidBy,
      amount: b.totalOwed,
    }));

  return {
    expenseId: expense.id,
    totalVerified: breakdown.reduce((s, b) => s + b.totalOwed, 0),
    roundingRemainder: remainder,
    breakdown,
    settlementGraph,
  };
}

// ─── Currency formatting ─────────────────────────────────────────────────────

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: '$',
  INR: '₹',
};

export function formatAmount(amount: number, currency: string): string {
  const symbol = CURRENCY_SYMBOLS[currency] ?? currency + ' ';
  return `${symbol}${Math.abs(amount).toFixed(2)}`;
}

// ─── Explanation builder ──────────────────────────────────────────────────────

function buildExplanation(
  itemSubtotal: number,
  chargeBreakdown: PersonBreakdown['chargeBreakdown'],
  totalOwed: number,
  currency: string
): string {
  const parts: string[] = [];

  if (itemSubtotal > 0) {
    parts.push(`Items: ${formatAmount(itemSubtotal, currency)}`);
  }

  for (const c of chargeBreakdown) {
    const sign = c.amount < 0 ? '-' : '+';
    parts.push(`${c.label}: ${sign}${formatAmount(c.amount, currency)}`);
  }

  return `${parts.join(', ')} = ${formatAmount(totalOwed, currency)} total`;
}
