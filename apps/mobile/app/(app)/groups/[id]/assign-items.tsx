import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
  Dimensions,
} from 'react-native';
import { router, useLocalSearchParams, Stack } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { computeSplit, formatAmount } from '@split-smart/split-engine';
import type { Expense, LineItem, LineItemParticipant, ChargeComponent, ExpenseParticipant, SplitRule } from '@split-smart/types';

const SCREEN_WIDTH = Dimensions.get('window').width;
const SWIPE_THRESHOLD = SCREEN_WIDTH * 0.3;

interface ItemRow {
  id: string;
  name: string;
  quantity: number;
  unit_price: number;
  total_price: number;
  position: number;
}

interface Member {
  userId: string;
  displayName: string;
}

// Track which users are assigned to each item
type Assignments = Record<string, Set<string>>; // itemId → Set<userId>

export default function AssignItemsScreen() {
  const { id: groupId, expenseId } = useLocalSearchParams<{ id: string; expenseId: string }>();
  const [items, setItems] = useState<ItemRow[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [assignments, setAssignments] = useState<Assignments>({});
  const [currency, setCurrency] = useState('USD');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!expenseId || !groupId) return;
    load();
  }, [expenseId, groupId]);

  async function load() {
    // Fetch currency, items, and group members in parallel
    const [{ data: group }, { data: lineItems }, { data: groupMembers }] = await Promise.all([
      supabase.from('groups').select('currency').eq('id', groupId).single(),
      supabase.from('line_items').select('*').eq('expense_id', expenseId).order('position'),
      supabase.from('group_members').select('user_id, profiles(display_name)').eq('group_id', groupId),
    ]);

    if (group) setCurrency(group.currency);
    if (lineItems) setItems(lineItems as ItemRow[]);

    if (groupMembers) {
      const m: Member[] = groupMembers.map((gm: any) => ({
        userId: gm.user_id,
        displayName: gm.profiles?.display_name ?? gm.user_id.slice(0, 8),
      }));
      setMembers(m);
    }

    // Fetch existing assignments
    if (lineItems && lineItems.length > 0) {
      const itemIds = lineItems.map((i: any) => i.id);
      const { data: lips } = await supabase
        .from('line_item_participants')
        .select('line_item_id, user_id')
        .in('line_item_id', itemIds);

      const a: Assignments = {};
      for (const item of lineItems) a[item.id] = new Set();
      for (const lip of lips ?? []) {
        a[lip.line_item_id]?.add(lip.user_id);
      }
      setAssignments(a);
    }
  }

  function toggleAssignment(itemId: string, userId: string) {
    setAssignments((prev) => {
      const updated = { ...prev };
      const set = new Set(updated[itemId] ?? []);
      if (set.has(userId)) {
        set.delete(userId);
      } else {
        set.add(userId);
      }
      updated[itemId] = set;
      return updated;
    });
  }

  function claimSole(itemId: string, userId: string) {
    setAssignments((prev) => {
      const updated = { ...prev };
      updated[itemId] = new Set([userId]);
      return updated;
    });
  }

  function splitEqual(itemId: string) {
    setAssignments((prev) => {
      const updated = { ...prev };
      updated[itemId] = new Set(members.map((m) => m.userId));
      return updated;
    });
  }

  function clearItem(itemId: string) {
    setAssignments((prev) => {
      const updated = { ...prev };
      updated[itemId] = new Set();
      return updated;
    });
  }

  async function handleSave() {
    setLoading(true);

    // Delete existing line_item_participants for this expense
    const itemIds = items.map((i) => i.id);
    if (itemIds.length > 0) {
      await supabase.from('line_item_participants').delete().in('line_item_id', itemIds);
    }

    // Insert new assignments
    const rows: Array<{ line_item_id: string; user_id: string; shares: number }> = [];
    for (const [itemId, userIds] of Object.entries(assignments)) {
      for (const userId of userIds) {
        rows.push({ line_item_id: itemId, user_id: userId, shares: 1 });
      }
    }

    if (rows.length > 0) {
      const { error } = await supabase.from('line_item_participants').insert(rows);
      if (error) {
        Alert.alert('Error', error.message);
        setLoading(false);
        return;
      }
    }

    // Also ensure all members are expense participants
    const { data: existingParts } = await supabase
      .from('expense_participants')
      .select('user_id')
      .eq('expense_id', expenseId);
    const existingUserIds = new Set((existingParts ?? []).map((p: any) => p.user_id));

    const newParticipants = members
      .filter((m) => !existingUserIds.has(m.userId))
      .map((m) => ({
        expense_id: expenseId,
        user_id: m.userId,
        owed_amount: 0,
        paid_amount: 0,
        is_included: true,
      }));

    if (newParticipants.length > 0) {
      await supabase.from('expense_participants').insert(newParticipants);
    }

    // Run the split engine and write owed_amount back to DB
    try {
      const { data: expRow, error: expErr } = await supabase.from('expenses').select('*').eq('id', expenseId).single();
      if (expErr || !expRow) {
        throw new Error(expErr?.message ?? 'Failed to retrieve expense row');
      }

      const { data: chargeRows, error: chargeErr } = await supabase.from('charge_components').select('*').eq('expense_id', expenseId);
      if (chargeErr) {
        throw new Error(chargeErr.message);
      }

      const { data: partRows, error: partErr } = await supabase.from('expense_participants').select('*').eq('expense_id', expenseId);
      if (partErr || !partRows || partRows.length === 0) {
        throw new Error(partErr?.message ?? 'No participants found for this expense');
      }

      const mappedExpense: Expense = {
        id: expRow.id, groupId: expRow.group_id, title: expRow.title,
        description: expRow.description, totalAmount: parseFloat(expRow.total_amount),
        currency: expRow.currency, category: expRow.category, billType: expRow.bill_type,
        paidBy: expRow.paid_by, date: expRow.date, receiptAssetId: expRow.receipt_asset_id,
        status: expRow.status, splitMethod: expRow.split_method,
        createdBy: expRow.created_by, createdAt: expRow.created_at, updatedAt: expRow.updated_at,
      };

      const mappedItems: LineItem[] = items.map((i) => ({
        id: i.id, expenseId: expenseId!, name: i.name,
        quantity: i.quantity, unitPrice: i.unit_price,
        totalPrice: i.total_price, position: i.position,
      }));

      const mappedLips: LineItemParticipant[] = rows.map((r, idx) => ({
        id: `lip-${idx}`, lineItemId: r.line_item_id, userId: r.user_id, shares: r.shares,
      }));

      const mappedCharges: ChargeComponent[] = (chargeRows ?? []).map((c: any) => ({
        id: c.id, expenseId: c.expense_id, type: c.type, label: c.label,
        amount: parseFloat(c.amount), rate: c.rate ? parseFloat(c.rate) : undefined,
        allocationRule: c.allocation_rule, excludedUserIds: c.excluded_user_ids ?? [],
        position: c.position,
      }));

      const mappedParticipants: ExpenseParticipant[] = partRows.map((p: any) => ({
        id: p.id, expenseId: p.expense_id, userId: p.user_id,
        owedAmount: 0, paidAmount: parseFloat(p.paid_amount), isIncluded: p.is_included,
      }));

      const splitRule: SplitRule = {
        id: 'default', expenseId: expenseId!, method: 'itemized', overrides: {},
      };

      const result = computeSplit({
        expense: mappedExpense, lineItems: mappedItems,
        lineItemParticipants: mappedLips, chargeComponents: mappedCharges,
        splitRule, participants: mappedParticipants,
      });

      // Write computed owed_amount back to each participant, throwing on any error to prevent placeholders/stale data
      const updatePromises = result.breakdown.map(async (b) => {
        const { error: updateErr } = await supabase
          .from('expense_participants')
          .update({ owed_amount: Math.round(b.totalOwed * 100) / 100 })
          .eq('expense_id', expenseId)
          .eq('user_id', b.userId);
        if (updateErr) {
          throw new Error(`Failed to update participant ${b.userId}: ${updateErr.message}`);
        }
      });
      await Promise.all(updatePromises);
    } catch (e: any) {
      Alert.alert('Calculation Error', e.message ?? 'An unexpected error occurred during split calculation.');
      setLoading(false);
      return;
    }

    setLoading(false);
    router.replace(`/(app)/groups/${groupId}/bill/${expenseId}`);
  }

  // Compute per-person summary
  const personTotals = new Map<string, number>();
  for (const item of items) {
    const assigned = assignments[item.id];
    if (!assigned || assigned.size === 0) {
      // Unassigned: split equally among all members
      const share = item.total_price / (members.length || 1);
      for (const m of members) {
        personTotals.set(m.userId, (personTotals.get(m.userId) ?? 0) + share);
      }
    } else {
      const share = item.total_price / assigned.size;
      for (const uid of assigned) {
        personTotals.set(uid, (personTotals.get(uid) ?? 0) + share);
      }
    }
  }

  const sym = currency === 'INR' ? '₹' : '$';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Assign Items' }} />

      <Text style={styles.hint}>
        Tap a person to split an item with them. Tap "sole" to claim it entirely.
        Unassigned items are split equally among everyone.
      </Text>

      {/* Item cards */}
      {items.map((item) => {
        const assigned = assignments[item.id] ?? new Set();
        const isUnassigned = assigned.size === 0;

        return (
          <View key={item.id} style={styles.itemCard}>
            <View style={styles.itemHeader}>
              <View>
                <Text style={styles.itemName}>{item.name}</Text>
                <Text style={styles.itemPrice}>
                  {item.quantity > 1 ? `${item.quantity} x ` : ''}
                  {formatAmount(item.total_price, currency)}
                </Text>
              </View>
              <Text style={[styles.assignStatus, isUnassigned && styles.unassigned]}>
                {isUnassigned ? 'Equal split' : `${assigned.size} claimed`}
              </Text>
            </View>

            {/* Member buttons */}
            <View style={styles.memberRow}>
              {members.map((m) => {
                const isSelected = assigned.has(m.userId);
                return (
                  <TouchableOpacity
                    key={m.userId}
                    style={[styles.memberChip, isSelected && styles.memberChipActive]}
                    onPress={() => toggleAssignment(item.id, m.userId)}
                    onLongPress={() => claimSole(item.id, m.userId)}
                  >
                    <Text style={[styles.memberChipText, isSelected && styles.memberChipTextActive]}>
                      {m.displayName}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Quick actions */}
            <View style={styles.quickActions}>
              <TouchableOpacity onPress={() => splitEqual(item.id)} style={styles.quickBtn}>
                <Text style={styles.quickText}>Split equal</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => clearItem(item.id)} style={styles.quickBtn}>
                <Text style={styles.quickText}>Clear</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}

      {/* Per-person summary */}
      {members.length > 0 && (
        <>
          <Text style={styles.summaryTitle}>Summary (items only)</Text>
          {members.map((m) => (
            <View key={m.userId} style={styles.summaryRow}>
              <Text style={styles.summaryName}>{m.displayName}</Text>
              <Text style={styles.summaryAmount}>
                {sym}{(personTotals.get(m.userId) ?? 0).toFixed(2)}
              </Text>
            </View>
          ))}
        </>
      )}

      <TouchableOpacity style={styles.saveBtn} onPress={handleSave} disabled={loading}>
        <Text style={styles.saveBtnText}>{loading ? 'Saving...' : 'Save Assignments'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  content: { padding: 16, paddingBottom: 40 },
  hint: { fontSize: 13, color: '#6b7280', backgroundColor: '#f3f4f6', borderRadius: 10, padding: 12, marginBottom: 16, lineHeight: 18 },
  itemCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6 },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 },
  itemName: { fontSize: 15, fontWeight: '600', color: '#111827' },
  itemPrice: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  assignStatus: { fontSize: 12, fontWeight: '600', color: '#16a34a' },
  unassigned: { color: '#9ca3af' },
  memberRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 },
  memberChip: { borderWidth: 1.5, borderColor: '#d1d5db', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 7, backgroundColor: '#fff' },
  memberChipActive: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  memberChipText: { fontSize: 13, color: '#6b7280', fontWeight: '500' },
  memberChipTextActive: { color: '#fff', fontWeight: '700' },
  quickActions: { flexDirection: 'row', gap: 12 },
  quickBtn: { paddingVertical: 4 },
  quickText: { fontSize: 12, color: '#2563eb', fontWeight: '500' },
  summaryTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginTop: 20, marginBottom: 10 },
  summaryRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#f3f4f6' },
  summaryName: { fontSize: 14, color: '#374151' },
  summaryAmount: { fontSize: 14, fontWeight: '600', color: '#111827' },
  saveBtn: { backgroundColor: '#16a34a', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 20 },
  saveBtnText: { color: '#fff', fontWeight: '600', fontSize: 16 },
});
