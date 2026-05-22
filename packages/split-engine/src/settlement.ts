import type {
  ExpenseDebt,
  ExpenseLink,
  SettlementMode,
  TraceableTransfer,
} from '@splitmate/types';
import { roundCents } from './rounding';

/**
 * Compute the set of transfers needed to settle every active debt.
 *
 *   - direct:    one transfer per (debtor, creditor, expense) atom.
 *                preserves which bill each transfer came from at the cost
 *                of more transactions.
 *   - optimized: greedy min-flow on net balances. Produces the minimum
 *                number of transfers; each one carries `expenseLinks[]`
 *                pointing back to the source bills that contributed.
 *
 * Currency is passed through because `ExpenseDebt` doesn't carry it
 * (the group does). The caller -- a hook or screen -- supplies the
 * group's currency.
 *
 * Partial-settlement subtraction (subtracting already-paid amounts before
 * computing transfers) is *not* the engine's job. Callers should reduce
 * `breakdown[].totalOwed` by amounts already covered in
 * `settlement_expense_links` before calling this function.
 */
export function computeGroupSettlement(
  debts: ExpenseDebt[],
  mode: SettlementMode,
  currency: string,
): { transfers: TraceableTransfer[] } {
  const atoms = flattenToAtoms(debts);

  if (mode === 'direct') {
    return { transfers: directTransfers(atoms, currency) };
  }
  return { transfers: optimizedTransfers(atoms, currency) };
}

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------
type DebtAtom = {
  from: string;
  to: string;
  amount: number;
  expenseId: string;
};

function flattenToAtoms(debts: ExpenseDebt[]): DebtAtom[] {
  const out: DebtAtom[] = [];
  for (const debt of debts) {
    for (const row of debt.breakdown) {
      if (row.userId === debt.paidBy) continue; // payer doesn't owe themselves
      const amt = roundCents(row.totalOwed);
      if (amt <= 0.005) continue;
      out.push({
        from: row.userId,
        to: debt.paidBy,
        amount: amt,
        expenseId: debt.expenseId,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Direct mode
// ---------------------------------------------------------------------------
function directTransfers(atoms: DebtAtom[], currency: string): TraceableTransfer[] {
  return atoms.map((a) => ({
    fromUserId: a.from,
    toUserId: a.to,
    amount: a.amount,
    currency,
    expenseLinks: [{ expenseId: a.expenseId, amount: a.amount }],
  }));
}

// ---------------------------------------------------------------------------
// Optimized mode (greedy min-flow + traceability re-walk)
// ---------------------------------------------------------------------------
function optimizedTransfers(atoms: DebtAtom[], currency: string): TraceableTransfer[] {
  if (atoms.length === 0) return [];

  // 1. Net balance per user. Positive = net creditor (others owe them).
  //                          Negative = net debtor (they owe others).
  const balance = new Map<string, number>();
  for (const a of atoms) {
    balance.set(a.from, (balance.get(a.from) ?? 0) - a.amount);
    balance.set(a.to, (balance.get(a.to) ?? 0) + a.amount);
  }

  // 2. Round + drop near-zero balances.
  const balanceList = Array.from(balance.entries())
    .map(([id, v]) => ({ id, balance: roundCents(v) }))
    .filter((b) => Math.abs(b.balance) >= 0.005);

  if (balanceList.length === 0) return [];

  // 3. Sort creditors descending, debtors descending by absolute owed.
  //    Tie-break by lexicographic userId so output is deterministic.
  const creditors = balanceList
    .filter((b) => b.balance > 0)
    .sort((a, b) => (b.balance !== a.balance ? b.balance - a.balance : a.id.localeCompare(b.id)));
  const debtors = balanceList
    .filter((b) => b.balance < 0)
    .sort((a, b) => (a.balance !== b.balance ? a.balance - b.balance : a.id.localeCompare(b.id)));

  // 4. Greedy match: largest debtor pays largest creditor as much as possible.
  type RawTransfer = { from: string; to: string; amount: number };
  const raw: RawTransfer[] = [];

  let ci = 0;
  let di = 0;
  let creditorRemaining = creditors[0]?.balance ?? 0;
  let debtorRemaining = debtors[0] ? -debtors[0].balance : 0;

  while (ci < creditors.length && di < debtors.length) {
    const amt = roundCents(Math.min(creditorRemaining, debtorRemaining));
    if (amt > 0.005) {
      raw.push({ from: debtors[di]!.id, to: creditors[ci]!.id, amount: amt });
    }
    creditorRemaining = roundCents(creditorRemaining - amt);
    debtorRemaining = roundCents(debtorRemaining - amt);
    if (creditorRemaining < 0.005) {
      ci++;
      creditorRemaining = creditors[ci]?.balance ?? 0;
    }
    if (debtorRemaining < 0.005) {
      di++;
      debtorRemaining = debtors[di] ? -debtors[di]!.balance : 0;
    }
  }

  // 5. Re-walk atoms to attach `expenseLinks` to each transfer. For each
  //    (from -> to) transfer, consume atoms with the same `from`, ordered
  //    by expenseId for determinism. This isn't perfect provenance when
  //    the optimizer rerouted through the graph, but it picks the most
  //    intuitive attribution (the debtor's actual owed bills).
  const atomState = atoms.map((a) => ({ ...a, remaining: a.amount }));
  const result: TraceableTransfer[] = [];

  for (const t of raw) {
    const links: ExpenseLink[] = [];
    let remaining = t.amount;

    const candidates = atomState
      .filter((a) => a.from === t.from && a.remaining > 0.005)
      .sort((a, b) => a.expenseId.localeCompare(b.expenseId));

    for (const cand of candidates) {
      if (remaining <= 0.005) break;
      const take = roundCents(Math.min(cand.remaining, remaining));
      if (take <= 0.005) continue;

      const existing = links.find((l) => l.expenseId === cand.expenseId);
      if (existing) {
        existing.amount = roundCents(existing.amount + take);
      } else {
        links.push({ expenseId: cand.expenseId, amount: take });
      }
      cand.remaining = roundCents(cand.remaining - take);
      remaining = roundCents(remaining - take);
    }

    result.push({
      fromUserId: t.from,
      toUserId: t.to,
      amount: t.amount,
      currency,
      expenseLinks: links,
    });
  }

  return result;
}
