import { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { supabase } from '@/lib/supabase';
import {
  computeGroupSettlement,
  formatAmount,
} from '@split-smart/split-engine';
import type { ExpenseDebt, TraceableTransfer } from '@split-smart/split-engine';
import type { SettlementMode } from '@split-smart/types';

interface ProfileMap { [id: string]: string }
interface ExpenseNameMap { [id: string]: string }

export default function SettleScreen() {
  const { id: groupId } = useLocalSearchParams<{ id: string }>();
  const [transfers, setTransfers] = useState<TraceableTransfer[]>([]);
  const [mode, setMode] = useState<SettlementMode>('optimized');
  const [profiles, setProfiles] = useState<ProfileMap>({});
  const [expenseNames, setExpenseNames] = useState<ExpenseNameMap>({});
  const [currency, setCurrency] = useState('USD');

  useEffect(() => {
    if (!groupId) return;
    load();
  }, [groupId]);

  async function load() {
    // Fetch group info
    const { data: group } = await supabase
      .from('groups')
      .select('currency, settlement_mode')
      .eq('id', groupId)
      .single();
    if (!group) return;
    setCurrency(group.currency);
    setMode(group.settlement_mode);

    // Fetch active expenses with their breakdowns
    const { data: expenses } = await supabase
      .from('expenses')
      .select('id, title, paid_by, total_amount')
      .eq('group_id', groupId)
      .eq('status', 'active');

    if (!expenses || expenses.length === 0) {
      setTransfers([]);
      return;
    }

    // Build expense name map
    const nameMap: ExpenseNameMap = {};
    for (const e of expenses) nameMap[e.id] = e.title;
    setExpenseNames(nameMap);

    // Fetch participants for each expense
    const expenseIds = expenses.map((e: any) => e.id);
    const { data: allParticipants } = await supabase
      .from('expense_participants')
      .select('expense_id, user_id, owed_amount')
      .in('expense_id', expenseIds);

    // Build expense debts
    const debts: ExpenseDebt[] = expenses.map((e: any) => ({
      expenseId: e.id,
      paidBy: e.paid_by,
      breakdown: (allParticipants ?? [])
        .filter((p: any) => p.expense_id === e.id)
        .map((p: any) => ({ userId: p.user_id, totalOwed: parseFloat(p.owed_amount) })),
    }));

    // Compute settlement
    const result = computeGroupSettlement(debts, group.settlement_mode);
    setTransfers(result.transfers);

    // Fetch profile names
    const userIds = new Set<string>();
    for (const t of result.transfers) {
      userIds.add(t.fromUserId);
      userIds.add(t.toUserId);
    }
    if (userIds.size > 0) {
      const { data: profileRows } = await supabase
        .from('profiles')
        .select('id, display_name')
        .in('id', Array.from(userIds));
      const pMap: ProfileMap = {};
      for (const p of profileRows ?? []) pMap[p.id] = p.display_name;
      setProfiles(pMap);
    }
  }

  async function handleMarkSettled(transfer: TraceableTransfer) {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { error } = await supabase.from('settlements').insert({
      group_id: groupId,
      from_user_id: transfer.fromUserId,
      to_user_id: transfer.toUserId,
      amount: transfer.amount,
      currency,
      status: 'completed',
      settled_at: new Date().toISOString(),
    });

    if (error) {
      Alert.alert('Error', error.message);
      return;
    }

    // Insert traceability links
    for (const link of transfer.expenseLinks) {
      await supabase.from('settlement_expense_links').insert({
        settlement_id: transfer.fromUserId, // will be replaced with actual settlement ID
        expense_id: link.expenseId,
        amount_from_expense: link.amount,
      });
    }

    Alert.alert('Settled', 'Payment marked as complete');
    load(); // refresh
  }

  const getName = (id: string) => profiles[id] ?? id.slice(0, 8);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: 'Settle Up' }} />

      <View style={styles.modeCard}>
        <Text style={styles.modeLabel}>
          Mode: {mode === 'optimized' ? 'Optimized (fewer transfers)' : 'Direct (per expense)'}
        </Text>
      </View>

      {transfers.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>All settled!</Text>
          <Text style={styles.emptySubtitle}>No outstanding balances in this group</Text>
        </View>
      ) : (
        transfers.map((t, i) => (
          <View key={i} style={styles.transferCard}>
            <View style={styles.transferHeader}>
              <View style={styles.transferFlow}>
                <Text style={styles.fromName}>{getName(t.fromUserId)}</Text>
                <Text style={styles.arrow}>pays</Text>
                <Text style={styles.toName}>{getName(t.toUserId)}</Text>
              </View>
              <Text style={styles.transferAmount}>
                {formatAmount(t.amount, currency)}
              </Text>
            </View>

            {/* Traceability — which bills this covers */}
            {t.expenseLinks.length > 0 && (
              <View style={styles.traceSection}>
                {t.expenseLinks.map((link, j) => (
                  <Text key={j} style={styles.traceText}>
                    {formatAmount(link.amount, currency)} from "{expenseNames[link.expenseId] ?? 'bill'}"
                  </Text>
                ))}
              </View>
            )}

            <TouchableOpacity
              style={styles.settleBtn}
              onPress={() => handleMarkSettled(t)}
            >
              <Text style={styles.settleBtnText}>Mark as paid</Text>
            </TouchableOpacity>
          </View>
        ))
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  content: { padding: 16, paddingBottom: 40 },
  modeCard: { backgroundColor: '#eff6ff', borderRadius: 10, padding: 12, marginBottom: 16 },
  modeLabel: { fontSize: 13, color: '#1e40af', fontWeight: '500', textAlign: 'center' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 80 },
  emptyTitle: { fontSize: 20, fontWeight: '700', color: '#16a34a' },
  emptySubtitle: { fontSize: 14, color: '#9ca3af', marginTop: 6 },
  transferCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 12, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6 },
  transferHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  transferFlow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  fromName: { fontSize: 15, fontWeight: '700', color: '#dc2626' },
  arrow: { fontSize: 13, color: '#9ca3af' },
  toName: { fontSize: 15, fontWeight: '700', color: '#16a34a' },
  transferAmount: { fontSize: 18, fontWeight: '800', color: '#111827' },
  traceSection: { marginTop: 10, paddingTop: 10, borderTopWidth: 1, borderTopColor: '#f3f4f6' },
  traceText: { fontSize: 12, color: '#6b7280', marginBottom: 3 },
  settleBtn: { marginTop: 12, backgroundColor: '#2563eb', borderRadius: 8, paddingVertical: 10, alignItems: 'center' },
  settleBtnText: { color: '#fff', fontWeight: '600', fontSize: 14 },
});
