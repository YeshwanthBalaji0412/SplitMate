import type {
  AllocationRule,
  ChargeComponent,
  ChargeType,
  ExpenseParticipant,
  LineItem,
  LineItemParticipant,
  SplitBreakdownEntry,
  SplitInput,
  SplitResult,
} from '@splitmate/types';
import { assignLeftover, roundCents } from './rounding';

/**
 * Order in which charges are applied. Critical: discounts must reduce the
 * base before tax is allocated, otherwise tax is paid on money that was
 * never charged.
 *
 *   1. discounts (reduce post-discount subtotal)
 *   2. taxes    (allocated on post-discount base)
 *   3. fees     (tip, service, delivery, platform, surge, ...)
 *
 * Within each tier, original `position` order is preserved.
 */
function chargeTier(type: ChargeType): number {
  if (type === 'discount') return 0;
  if (type === 'tax') return 1;
  return 2;
}

function sortChargesByOrder(charges: ChargeComponent[]): ChargeComponent[] {
  return [...charges].sort((a, b) => {
    const ta = chargeTier(a.type);
    const tb = chargeTier(b.type);
    if (ta !== tb) return ta - tb;
    return a.position - b.position;
  });
}

function breakdownTypeFor(t: ChargeType): SplitBreakdownEntry['type'] {
  if (t === 'discount') return 'discount';
  if (t === 'tax') return 'tax';
  return 'charge';
}

function noteForRule(rule: AllocationRule, count: number): string {
  switch (rule) {
    case 'proportional_subtotal':
      return 'proportional to your subtotal';
    case 'proportional_order_value':
      return 'proportional to your order value';
    case 'equal_per_person':
      return `1/${count} equal share`;
    case 'flat_per_person':
      return 'flat per person';
    case 'item_specific':
      return 'item-specific allocation';
    case 'alcohol_only':
      return 'allocated to alcohol claimants';
  }
}

type UserAccumulator = {
  userId: string;
  /** Sum of item shares before any charge is applied. */
  itemSubtotal: number;
  /** Item subtotal minus this user's share of all discounts. Used as the
   *  base for `proportional_subtotal` on later charges. */
  postDiscount: number;
  /** Running total = items + charges with sign. */
  total: number;
  entries: SplitBreakdownEntry[];
};

/**
 * Compute the per-user split of a single expense.
 *
 * Pipeline:
 *   1. Filter to included participants.
 *   2. Allocate line items via line_item_participants (or equal-split if
 *      none are claimed). Sole / shared / quantity-shares all handled by
 *      summing `shares` and dividing the item total proportionally.
 *   3. Sort charges by tier (discount -> tax -> fee), preserving `position`
 *      within each tier.
 *   4. For each charge, compute per-user shares based on its allocationRule,
 *      round, distribute the leftover cent deterministically, and append a
 *      breakdown entry to the affected users.
 *   5. Final pass: ensure sum of user totals == expense.totalAmount exactly,
 *      reassigning any final-rounding leftover deterministically.
 *
 * `equal` method bypasses items + charges and just splits expense.totalAmount
 * equally across included participants -- the leftover-cent rule guarantees
 * the sum is exact.
 */
export function computeSplit(input: SplitInput): SplitResult {
  const { expense, lineItems, lineItemParticipants, chargeComponents, splitRule, participants } =
    input;

  const included = participants.filter((p) => p.isIncluded);

  if (included.length === 0) {
    return {
      expenseId: expense.id,
      currency: expense.currency,
      byUser: [],
    };
  }

  // ---------- equal-method fast path ----------
  if (splitRule.method === 'equal') {
    return equalSplit(input, included);
  }

  // ---------- itemized path ----------
  const accs = new Map<string, UserAccumulator>();
  for (const p of included) {
    accs.set(p.userId, {
      userId: p.userId,
      itemSubtotal: 0,
      postDiscount: 0,
      total: 0,
      entries: [],
    });
  }
  const includedIds = new Set(included.map((p) => p.userId));

  allocateItems(lineItems, lineItemParticipants, accs, includedIds, included);

  // Snapshot item subtotals as the initial `postDiscount` base.
  for (const acc of accs.values()) {
    acc.postDiscount = acc.itemSubtotal;
    acc.total = acc.itemSubtotal;
  }

  for (const charge of sortChargesByOrder(chargeComponents)) {
    applyCharge(charge, accs, included, lineItems, lineItemParticipants);
  }

  // Final reconciliation: ensure sum of totals == expense.totalAmount.
  return finalize(input, accs);
}

// ---------------------------------------------------------------------------
// Equal-split path
// ---------------------------------------------------------------------------
function equalSplit(input: SplitInput, included: ExpenseParticipant[]): SplitResult {
  const { expense } = input;
  const per = expense.totalAmount / included.length;
  const raw = included.map((p) => ({ key: p.userId, value: per }));
  const adjusted = assignLeftover(raw, expense.totalAmount);

  const byUser = adjusted.map((row) => ({
    userId: row.key,
    totalOwed: row.value,
    entries: [
      {
        type: 'item' as const,
        description: `Equal share of ${expense.title}`,
        amount: row.value,
        note: `1/${included.length} of ${expense.totalAmount.toFixed(2)}`,
      },
    ],
  }));

  return {
    expenseId: expense.id,
    currency: expense.currency,
    byUser,
  };
}

// ---------------------------------------------------------------------------
// Item allocation
// ---------------------------------------------------------------------------
function allocateItems(
  lineItems: LineItem[],
  lips: LineItemParticipant[],
  accs: Map<string, UserAccumulator>,
  includedIds: Set<string>,
  included: ExpenseParticipant[],
): void {
  for (const item of lineItems) {
    const claimants = lips.filter(
      (lp) => lp.lineItemId === item.id && includedIds.has(lp.userId),
    );

    if (claimants.length === 0) {
      // Unassigned item -> equal split across included participants.
      const per = item.totalPrice / included.length;
      for (const p of included) {
        const acc = accs.get(p.userId)!;
        acc.itemSubtotal += per;
        acc.entries.push({
          type: 'item',
          description: item.name,
          amount: per,
          note: `1/${included.length} share (unclaimed, equal)`,
        });
      }
      continue;
    }

    const totalShares = claimants.reduce((s, c) => s + c.shares, 0);
    for (const c of claimants) {
      const share = item.totalPrice * (c.shares / totalShares);
      const acc = accs.get(c.userId)!;
      acc.itemSubtotal += share;
      const noteText =
        claimants.length === 1
          ? 'sole claim'
          : c.shares === totalShares / claimants.length
            ? `1/${claimants.length} share`
            : `${c.shares}/${totalShares} share`;
      acc.entries.push({
        type: 'item',
        description: item.name,
        amount: share,
        note: noteText,
      });
    }
  }
}

// ---------------------------------------------------------------------------
// Charge allocation
// ---------------------------------------------------------------------------
function applyCharge(
  charge: ChargeComponent,
  accs: Map<string, UserAccumulator>,
  included: ExpenseParticipant[],
  lineItems: LineItem[],
  lips: LineItemParticipant[],
): void {
  // Magnitude: charges stored as |amount|. Discounts can be stored either
  // as positive or negative -- we treat them uniformly as a magnitude
  // reduction. Sign convention is applied via `sign` below.
  const magnitude = Math.abs(charge.amount);
  if (magnitude < 0.005) return;

  const sign = charge.type === 'discount' ? -1 : 1;

  const excluded = new Set(charge.excludedUserIds);
  const recipientIds = included.map((p) => p.userId).filter((id) => !excluded.has(id));
  if (recipientIds.length === 0) return;

  const shares = computeChargeShares(charge, recipientIds, accs, lineItems, lips);

  const rounded = recipientIds.map((id) => ({
    key: id,
    value: roundCents(shares.get(id) ?? 0),
  }));
  const adjusted = assignLeftover(rounded, roundCents(magnitude));

  for (const row of adjusted) {
    const acc = accs.get(row.key);
    if (!acc) continue;
    const signed = roundCents(row.value * sign);
    acc.total += signed;
    if (charge.type === 'discount') {
      acc.postDiscount += signed; // signed is negative -> reduces base for later tax
    }
    acc.entries.push({
      type: breakdownTypeFor(charge.type),
      description: charge.label || charge.type,
      amount: signed,
      note: noteForRule(charge.allocationRule, recipientIds.length),
    });
  }
}

function computeChargeShares(
  charge: ChargeComponent,
  recipientIds: string[],
  accs: Map<string, UserAccumulator>,
  lineItems: LineItem[],
  lips: LineItemParticipant[],
): Map<string, number> {
  const magnitude = Math.abs(charge.amount);
  const out = new Map<string, number>();

  switch (charge.allocationRule) {
    case 'proportional_subtotal': {
      assignProportional(out, recipientIds, magnitude, (id) =>
        Math.max(0, accs.get(id)?.postDiscount ?? 0),
      );
      return out;
    }
    case 'proportional_order_value': {
      assignProportional(out, recipientIds, magnitude, (id) =>
        Math.max(0, accs.get(id)?.itemSubtotal ?? 0),
      );
      return out;
    }
    case 'equal_per_person':
    case 'flat_per_person': {
      const per = magnitude / recipientIds.length;
      for (const id of recipientIds) out.set(id, per);
      return out;
    }
    case 'alcohol_only': {
      const alcoholItemIds = new Set(
        lineItems.filter((li) => li.category === 'alcohol').map((li) => li.id),
      );
      const alcoholClaimers = new Set(
        lips.filter((lp) => alcoholItemIds.has(lp.lineItemId)).map((lp) => lp.userId),
      );
      const eligible = recipientIds.filter((id) => alcoholClaimers.has(id));
      if (eligible.length === 0) {
        // No alcohol claimants in this group. Defensive fallback: split
        // equally across recipients rather than dropping the charge.
        const per = magnitude / recipientIds.length;
        for (const id of recipientIds) out.set(id, per);
      } else {
        const per = magnitude / eligible.length;
        for (const id of eligible) out.set(id, per);
      }
      return out;
    }
    case 'item_specific': {
      // Phase 7 stub: requires a charge<->item link we don't model yet.
      // Falls back to proportional_subtotal so the charge isn't silently dropped.
      // TODO(future phase): once charge_components has a target_item_ids
      // column, allocate by that and remove this fallback.
      assignProportional(out, recipientIds, magnitude, (id) =>
        Math.max(0, accs.get(id)?.postDiscount ?? 0),
      );
      return out;
    }
  }
}

function assignProportional(
  out: Map<string, number>,
  recipientIds: string[],
  magnitude: number,
  baseFor: (id: string) => number,
): void {
  const bases = recipientIds.map((id) => ({ id, base: baseFor(id) }));
  const totalBase = bases.reduce((s, b) => s + b.base, 0);
  if (totalBase <= 0.005) {
    // No one has a positive base (e.g. charges before any items): equal split.
    const per = magnitude / recipientIds.length;
    for (const id of recipientIds) out.set(id, per);
    return;
  }
  for (const b of bases) {
    out.set(b.id, magnitude * (b.base / totalBase));
  }
}

// ---------------------------------------------------------------------------
// Final reconciliation
// ---------------------------------------------------------------------------
function finalize(input: SplitInput, accs: Map<string, UserAccumulator>): SplitResult {
  const { expense } = input;
  const users = Array.from(accs.values());

  // Reconcile any final-pass drift: sum(user.total) must equal expense.totalAmount.
  const raw = users.map((u) => ({ key: u.userId, value: u.total }));
  const adjusted = assignLeftover(raw, expense.totalAmount);

  const byUser = users.map((u, i) => {
    const finalTotal = adjusted[i]!.value;
    return {
      userId: u.userId,
      totalOwed: finalTotal,
      entries: u.entries.map((e) => ({ ...e, amount: roundCents(e.amount) })),
    };
  });

  return {
    expenseId: expense.id,
    currency: expense.currency,
    byUser,
  };
}
