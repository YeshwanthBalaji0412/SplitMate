import { useCallback, useEffect, useState } from 'react';
import type {
  AllocationRule,
  BillType,
  ChargeComponent,
  ChargeType,
  Expense,
  ExpenseCategory,
  ExpenseParticipant,
  ExpenseStatus,
  InputSource,
  ItemCategory,
  LineItem,
  LineItemParticipant,
  SplitMethod,
} from '@splitmate/types';
import { supabase } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Row -> camelCase mappers
// ---------------------------------------------------------------------------

export function rowToExpense(row: Record<string, unknown>): Expense {
  return {
    id: row.id as string,
    groupId: row.group_id as string,
    title: row.title as string,
    description: (row.description as string | null) ?? null,
    totalAmount: parseFloat(row.total_amount as string),
    currency: row.currency as string,
    category: row.category as ExpenseCategory,
    billType: row.bill_type as BillType,
    inputSource: row.input_source as InputSource,
    paidBy: row.paid_by as string,
    date: row.date as string,
    status: row.status as ExpenseStatus,
    settledAt: (row.settled_at as string | null) ?? null,
    splitMethod: row.split_method as SplitMethod,
    createdBy: row.created_by as string,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function rowToLineItem(row: Record<string, unknown>): LineItem {
  return {
    id: row.id as string,
    expenseId: row.expense_id as string,
    name: row.name as string,
    quantity: parseFloat(row.quantity as string),
    unitPrice: parseFloat(row.unit_price as string),
    totalPrice: parseFloat(row.total_price as string),
    category: (row.category as ItemCategory) ?? 'other',
    position: (row.position as number) ?? 0,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

export function rowToLineItemParticipant(row: Record<string, unknown>): LineItemParticipant {
  return {
    id: row.id as string,
    lineItemId: row.line_item_id as string,
    userId: row.user_id as string,
    shares: parseFloat(row.shares as string),
    createdAt: row.created_at as string,
  };
}

export function rowToCharge(row: Record<string, unknown>): ChargeComponent {
  return {
    id: row.id as string,
    expenseId: row.expense_id as string,
    type: row.type as ChargeType,
    label: row.label as string,
    amount: parseFloat(row.amount as string),
    rate: row.rate == null ? null : parseFloat(row.rate as string),
    allocationRule: row.allocation_rule as AllocationRule,
    excludedUserIds: (row.excluded_user_ids as string[]) ?? [],
    position: (row.position as number) ?? 0,
    createdAt: row.created_at as string,
  };
}

export function rowToParticipant(row: Record<string, unknown>): ExpenseParticipant {
  return {
    id: row.id as string,
    expenseId: row.expense_id as string,
    userId: row.user_id as string,
    isIncluded: row.is_included as boolean,
    owedAmount: parseFloat(row.owed_amount as string),
    paidAmount: parseFloat(row.paid_amount as string),
    createdAt: row.created_at as string,
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BillItemInput = {
  name: string;
  quantity: number;
  unitPrice: number;
};

export type BillChargeInput = {
  type: ChargeType;
  label: string;
  amount: number;
  allocationRule: AllocationRule;
};

export type CreateBillInput = {
  groupId: string;
  title: string;
  date: string; // ISO YYYY-MM-DD
  billType: BillType;
  paidBy: string; // userId
  currency: string;
  items: BillItemInput[];
  charges: BillChargeInput[];
  includedUserIds: string[];
};

export type CreateBillResult = { ok: true; expenseId: string } | { ok: false; error: string };

export type BillDetail = {
  expense: Expense;
  items: LineItem[];
  charges: ChargeComponent[];
  participants: ExpenseParticipant[];
  lineItemParticipants: LineItemParticipant[];
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Maps bill_type -> high-level analytics category.
 * `category` and `bill_type` are distinct columns: the engine cares about
 * bill_type; analytics rolls up by category.
 */
function billTypeToCategory(billType: BillType): ExpenseCategory {
  switch (billType) {
    case 'restaurant':
    case 'grocery':
    case 'delivery':
      return 'food';
    case 'accommodation':
      return 'accommodation';
    case 'utility':
      return 'utility';
    case 'subscription':
      return 'entertainment';
    case 'custom':
      return 'other';
  }
}

function computeTotal(items: BillItemInput[], charges: BillChargeInput[]): number {
  const itemSum = items.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
  const chargeSum = charges.reduce((s, c) => {
    const mag = Math.abs(c.amount);
    return c.type === 'discount' ? s - mag : s + mag;
  }, 0);
  return Math.round((itemSum + chargeSum) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

/**
 * Create a bill end-to-end: insert expense, line_items, charge_components,
 * expense_participants. Initial `owed_amount` is 0; the engine writes real
 * values after the user assigns items (see useExpenseSplit).
 *
 * No RPC needed: the caller is already a group member, so each row's RLS
 * SELECT-after-INSERT round-trip succeeds via the existing `is_group_member`
 * policy. Sequential inserts; partial failure surfaces an error so the
 * caller can retry. Orphaned expenses (if items insert fails after expense
 * insert) are a known small risk we accept for MVP.
 */
export async function createBill(input: CreateBillInput): Promise<CreateBillResult> {
  if (!input.title.trim()) return { ok: false, error: 'Bill title is required.' };
  if (input.items.length === 0 && input.charges.length === 0) {
    return { ok: false, error: 'Add at least one item or charge.' };
  }
  if (input.includedUserIds.length === 0) {
    return { ok: false, error: 'At least one member must be on the bill.' };
  }
  if (!input.includedUserIds.includes(input.paidBy)) {
    return { ok: false, error: 'The payer must be on the bill.' };
  }

  const totalAmount = computeTotal(input.items, input.charges);
  if (totalAmount <= 0) return { ok: false, error: 'Bill total must be greater than 0.' };

  const { data: sessionData } = await supabase.auth.getUser();
  const userId = sessionData.user?.id;
  if (!userId) return { ok: false, error: 'Not signed in.' };

  // 1. Create the expense row
  const { data: expenseRow, error: eErr } = await supabase
    .from('expenses')
    .insert({
      group_id: input.groupId,
      title: input.title.trim(),
      total_amount: totalAmount,
      currency: input.currency,
      category: billTypeToCategory(input.billType),
      bill_type: input.billType,
      input_source: 'manual',
      paid_by: input.paidBy,
      date: input.date,
      status: 'active',
      split_method: 'itemized',
      created_by: userId,
    })
    .select('id')
    .single();

  if (eErr || !expenseRow) {
    return { ok: false, error: eErr?.message ?? 'Failed to create bill.' };
  }
  const expenseId = expenseRow.id as string;

  // 2. Bulk-insert line items (if any)
  if (input.items.length > 0) {
    const itemRows = input.items.map((it, idx) => ({
      expense_id: expenseId,
      name: it.name,
      quantity: it.quantity,
      unit_price: it.unitPrice,
      total_price: Math.round(it.quantity * it.unitPrice * 100) / 100,
      position: idx,
    }));
    const { error: iErr } = await supabase.from('line_items').insert(itemRows);
    if (iErr) {
      // Best-effort cleanup; ignore the cleanup error (the user gets the real one).
      await supabase.from('expenses').delete().eq('id', expenseId);
      return { ok: false, error: `Failed to add items: ${iErr.message}` };
    }
  }

  // 3. Bulk-insert charges (if any)
  if (input.charges.length > 0) {
    const chargeRows = input.charges.map((c, idx) => ({
      expense_id: expenseId,
      type: c.type,
      label: c.label || c.type,
      amount: Math.abs(c.amount), // engine treats magnitude + sign-by-type
      allocation_rule: c.allocationRule,
      position: idx,
    }));
    const { error: cErr } = await supabase.from('charge_components').insert(chargeRows);
    if (cErr) {
      await supabase.from('expenses').delete().eq('id', expenseId);
      return { ok: false, error: `Failed to add charges: ${cErr.message}` };
    }
  }

  // 4. Bulk-insert participants with placeholder owed_amount=0
  const partRows = input.includedUserIds.map((uid) => ({
    expense_id: expenseId,
    user_id: uid,
    is_included: true,
    owed_amount: 0,
    paid_amount: uid === input.paidBy ? totalAmount : 0,
  }));
  const { error: pErr } = await supabase.from('expense_participants').insert(partRows);
  if (pErr) {
    await supabase.from('expenses').delete().eq('id', expenseId);
    return { ok: false, error: `Failed to add participants: ${pErr.message}` };
  }

  return { ok: true, expenseId };
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

export function useBillsInGroup(groupId: string | undefined) {
  const [bills, setBills] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!groupId) {
      setBills([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const { data, error: e } = await supabase
      .from('expenses')
      .select('*')
      .eq('group_id', groupId)
      .order('date', { ascending: false })
      .order('created_at', { ascending: false });

    if (e) {
      setError(e.message);
      setLoading(false);
      return;
    }
    setBills((data ?? []).map(rowToExpense));
    setLoading(false);
  }, [groupId]);

  useEffect(() => {
    load();
  }, [load]);

  return { bills, loading, error, refresh: load };
}

export function useBillDetail(expenseId: string | undefined) {
  const [bill, setBill] = useState<BillDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!expenseId) {
      setBill(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);

    const { data: expenseRow, error: eErr } = await supabase
      .from('expenses')
      .select('*')
      .eq('id', expenseId)
      .maybeSingle();

    if (eErr || !expenseRow) {
      setError(eErr?.message ?? 'Bill not found.');
      setBill(null);
      setLoading(false);
      return;
    }

    const [itemsRes, chargesRes, partRes] = await Promise.all([
      supabase.from('line_items').select('*').eq('expense_id', expenseId).order('position'),
      supabase.from('charge_components').select('*').eq('expense_id', expenseId).order('position'),
      supabase.from('expense_participants').select('*').eq('expense_id', expenseId),
    ]);

    const items = (itemsRes.data ?? []).map(rowToLineItem);
    const charges = (chargesRes.data ?? []).map(rowToCharge);
    const participants = (partRes.data ?? []).map(rowToParticipant);

    const lipRes =
      items.length > 0
        ? await supabase
            .from('line_item_participants')
            .select('*')
            .in(
              'line_item_id',
              items.map((i) => i.id),
            )
        : { data: [], error: null };

    const lineItemParticipants = (lipRes.data ?? []).map(rowToLineItemParticipant);

    setBill({
      expense: rowToExpense(expenseRow),
      items,
      charges,
      participants,
      lineItemParticipants,
    });
    setLoading(false);
  }, [expenseId]);

  useEffect(() => {
    load();
  }, [load]);

  return { bill, loading, error, refresh: load };
}
