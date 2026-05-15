import { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { useLocalSearchParams, Stack, router } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { computeSplit, formatAmount } from '@split-smart/split-engine';
import type {
  Expense,
  LineItem,
  LineItemParticipant,
  ChargeComponent,
  ExpenseParticipant,
  SplitRule,
  PersonBreakdown,
} from '@split-smart/types';

interface ProfileMap {
  [userId: string]: string; // userId → displayName
}

export default function BillDetailScreen() {
  const { id: groupId, billId } = useLocalSearchParams<{ id: string; billId: string }>();
  const [expense, setExpense] = useState<Expense | null>(null);
  const [breakdown, setBreakdown] = useState<PersonBreakdown[]>([]);
  const [profiles, setProfiles] = useState<ProfileMap>({});
  const [expandedUser, setExpandedUser] = useState<string | null>(null);

  useEffect(() => {
    if (!billId) return;

    async function load() {
      // Fetch expense
      const { data: exp } = await supabase
        .from('expenses')
        .select('*')
        .eq('id', billId)
        .single();
      if (!exp) return;

      // Fetch related data in parallel
      const [{ data: items }, { data: lips }, { data: charges }, { data: participants }, { data: rules }] = await Promise.all([
        supabase.from('line_items').select('*').eq('expense_id', billId).order('position'),
        supabase.from('line_item_participants').select('*').in('line_item_id',
          (await supabase.from('line_items').select('id').eq('expense_id', billId)).data?.map((i: { id: string }) => i.id) ?? []
        ),
        supabase.from('charge_components').select('*').eq('expense_id', billId).order('position'),
        supabase.from('expense_participants').select('*').eq('expense_id', billId),
        supabase.from('split_rules').select('*').eq('expense_id', billId).limit(1),
      ]);

      // Map DB rows to engine types
      const mappedExpense: Expense = {
        id: exp.id,
        groupId: exp.group_id,
        title: exp.title,
        description: exp.description,
        totalAmount: parseFloat(exp.total_amount),
        currency: exp.currency,
        category: exp.category,
        billType: exp.bill_type,
        paidBy: exp.paid_by,
        date: exp.date,
        receiptAssetId: exp.receipt_asset_id,
        status: exp.status,
        splitMethod: exp.split_method,
        createdBy: exp.created_by,
        createdAt: exp.created_at,
        updatedAt: exp.updated_at,
      };

      const mappedItems: LineItem[] = (items ?? []).map((i: any) => ({
        id: i.id,
        expenseId: i.expense_id,
        name: i.name,
        quantity: parseFloat(i.quantity),
        unitPrice: parseFloat(i.unit_price),
        totalPrice: parseFloat(i.total_price),
        position: i.position,
      }));

      const mappedLips: LineItemParticipant[] = (lips ?? []).map((l: any) => ({
        id: l.id,
        lineItemId: l.line_item_id,
        userId: l.user_id,
        shares: parseFloat(l.shares),
      }));

      const mappedCharges: ChargeComponent[] = (charges ?? []).map((c: any) => ({
        id: c.id,
        expenseId: c.expense_id,
        type: c.type,
        label: c.label,
        amount: parseFloat(c.amount),
        rate: c.rate ? parseFloat(c.rate) : undefined,
        allocationRule: c.allocation_rule,
        excludedUserIds: c.excluded_user_ids ?? [],
        position: c.position,
      }));

      const mappedParticipants: ExpenseParticipant[] = (participants ?? []).map((p: any) => ({
        id: p.id,
        expenseId: p.expense_id,
        userId: p.user_id,
        owedAmount: parseFloat(p.owed_amount),
        paidAmount: parseFloat(p.paid_amount),
        isIncluded: p.is_included,
      }));

      const splitRule: SplitRule = rules?.[0]
        ? { id: rules[0].id, expenseId: rules[0].expense_id, method: rules[0].method, overrides: rules[0].overrides }
        : { id: 'default', expenseId: billId!, method: mappedExpense.splitMethod, overrides: {} };

      // Run split engine
      const result = computeSplit({
        expense: mappedExpense,
        lineItems: mappedItems,
        lineItemParticipants: mappedLips,
        chargeComponents: mappedCharges,
        splitRule,
        participants: mappedParticipants,
      });

      setExpense(mappedExpense);
      setBreakdown(result.breakdown);

      // Fetch display names
      const userIds = mappedParticipants.map((p) => p.userId);
      if (userIds.length > 0) {
        const { data: profileRows } = await supabase
          .from('profiles')
          .select('id, display_name')
          .in('id', userIds);
        const map: ProfileMap = {};
        for (const p of profileRows ?? []) {
          map[p.id] = p.display_name;
        }
        setProfiles(map);
      }
    }

    load();
  }, [billId]);

  if (!expense) return null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: expense.title }} />

      {/* Bill summary */}
      <View style={styles.summaryCard}>
        <Text style={styles.summaryTitle}>{expense.title}</Text>
        <Text style={styles.summaryTotal}>
          {formatAmount(expense.totalAmount, expense.currency)}
        </Text>
        <Text style={styles.summaryMeta}>
          {expense.billType} · {expense.date}
        </Text>
      </View>

      {/* Reassign items button */}
      <TouchableOpacity
        style={styles.assignBtn}
        onPress={() => router.push(`/(app)/groups/${groupId}/assign-items?expenseId=${billId}`)}
      >
        <Text style={styles.assignBtnText}>Reassign Items</Text>
      </TouchableOpacity>

      {/* Per-person breakdown — the core explainability view */}
      <Text style={styles.sectionTitle}>Who owes what</Text>

      {breakdown.map((person) => {
        const name = profiles[person.userId] ?? person.userId.slice(0, 8);
        const isPayer = person.userId === expense.paidBy;
        const isExpanded = expandedUser === person.userId;

        return (
          <TouchableOpacity
            key={person.userId}
            style={styles.personCard}
            onPress={() => setExpandedUser(isExpanded ? null : person.userId)}
            activeOpacity={0.7}
          >
            <View style={styles.personHeader}>
              <View>
                <Text style={styles.personName}>
                  {name} {isPayer ? '(paid)' : ''}
                </Text>
                <Text style={styles.personExplanation}>{person.explanation}</Text>
              </View>
              <Text style={styles.personAmount}>
                {formatAmount(person.totalOwed, expense.currency)}
              </Text>
            </View>

            {isExpanded && (
              <View style={styles.detailSection}>
                {person.itemSubtotal > 0 && (
                  <View style={styles.detailRow}>
                    <Text style={styles.detailLabel}>Items</Text>
                    <Text style={styles.detailValue}>
                      {formatAmount(person.itemSubtotal, expense.currency)}
                    </Text>
                  </View>
                )}
                {person.chargeBreakdown.map((c, i) => (
                  <View key={i} style={styles.detailRow}>
                    <Text style={styles.detailLabel}>{c.label}</Text>
                    <Text style={[styles.detailValue, c.amount < 0 && styles.discount]}>
                      {c.amount < 0 ? '-' : '+'}{formatAmount(c.amount, expense.currency)}
                    </Text>
                  </View>
                ))}
                <View style={[styles.detailRow, styles.totalRow]}>
                  <Text style={styles.detailTotalLabel}>Total</Text>
                  <Text style={styles.detailTotalValue}>
                    {formatAmount(person.totalOwed, expense.currency)}
                  </Text>
                </View>
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  content: { padding: 16, paddingBottom: 40 },
  summaryCard: { backgroundColor: '#fff', borderRadius: 16, padding: 20, alignItems: 'center', marginBottom: 20, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12 },
  summaryTitle: { fontSize: 18, fontWeight: '700', color: '#111827' },
  summaryTotal: { fontSize: 32, fontWeight: '800', color: '#16a34a', marginTop: 6 },
  summaryMeta: { fontSize: 13, color: '#9ca3af', marginTop: 6 },
  assignBtn: { backgroundColor: '#f3f4f6', borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginBottom: 16 },
  assignBtnText: { color: '#374151', fontWeight: '600', fontSize: 14 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 12 },
  personCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6 },
  personHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  personName: { fontSize: 15, fontWeight: '600', color: '#111827' },
  personExplanation: { fontSize: 12, color: '#9ca3af', marginTop: 3, maxWidth: 240 },
  personAmount: { fontSize: 17, fontWeight: '700', color: '#111827' },
  detailSection: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#f3f4f6' },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  detailLabel: { fontSize: 13, color: '#6b7280' },
  detailValue: { fontSize: 13, color: '#374151', fontWeight: '500' },
  discount: { color: '#16a34a' },
  totalRow: { borderTopWidth: 1, borderTopColor: '#e5e7eb', marginTop: 6, paddingTop: 8 },
  detailTotalLabel: { fontSize: 14, fontWeight: '700', color: '#111827' },
  detailTotalValue: { fontSize: 14, fontWeight: '700', color: '#111827' },
});
