import { useEffect, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  Pressable,
  StyleSheet,
  Alert,
  Platform,
} from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { supabase } from '@/lib/supabase';
import {
  computeSplit,
  computeGroupSettlement,
  formatAmount,
} from '@split-smart/split-engine';
import type { ExpenseDebt, TraceableTransfer } from '@split-smart/split-engine';
import type {
  SettlementMode,
  Expense,
  LineItem,
  LineItemParticipant,
  ChargeComponent,
  ExpenseParticipant,
  SplitRule,
} from '@split-smart/types';

interface ProfileMap { [id: string]: string }
interface ExpenseNameMap { [id: string]: string }

export default function SettleScreen() {
  const { id: groupId } = useLocalSearchParams<{ id: string }>();
  const [transfers, setTransfers] = useState<TraceableTransfer[]>([]);
  const [mode, setMode] = useState<SettlementMode>('optimized');
  const [profiles, setProfiles] = useState<ProfileMap>({});
  const [expenseNames, setExpenseNames] = useState<ExpenseNameMap>({});
  const [currency, setCurrency] = useState('USD');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!groupId) return;
    load();
  }, [groupId]);

  async function load() {
    setLoading(true);

    // Fetch group info
    const { data: group } = await supabase
      .from('groups')
      .select('currency, settlement_mode')
      .eq('id', groupId)
      .single();
    if (!group) { setLoading(false); return; }
    setCurrency(group.currency);
    setMode(group.settlement_mode);

    // Fetch active expenses
    const { data: expenses } = await supabase
      .from('expenses')
      .select('*')
      .eq('group_id', groupId)
      .eq('status', 'active');

    if (!expenses || expenses.length === 0) {
      setTransfers([]);
      setLoading(false);
      return;
    }

    // Build expense name map
    const nameMap: ExpenseNameMap = {};
    for (const e of expenses) nameMap[e.id] = e.title;
    setExpenseNames(nameMap);

    // For each expense, run the split engine to compute actual owed amounts
    const debts: ExpenseDebt[] = [];
    const allUserIds = new Set<string>();

    for (const exp of expenses) {
      const [{ data: items }, { data: charges }, { data: participants }] = await Promise.all([
        supabase.from('line_items').select('*').eq('expense_id', exp.id).order('position'),
        supabase.from('charge_components').select('*').eq('expense_id', exp.id).order('position'),
        supabase.from('expense_participants').select('*').eq('expense_id', exp.id),
      ]);

      if (!participants || participants.length === 0) continue;

      // Fetch line_item_participants
      const itemIds = (items ?? []).map((i: any) => i.id);
      const { data: lips } = itemIds.length > 0
        ? await supabase.from('line_item_participants').select('*').in('line_item_id', itemIds)
        : { data: [] };

      const mappedExpense: Expense = {
        id: exp.id, groupId: exp.group_id, title: exp.title,
        description: exp.description, totalAmount: parseFloat(exp.total_amount),
        currency: exp.currency, category: exp.category, billType: exp.bill_type ?? 'custom',
        paidBy: exp.paid_by, date: exp.date, receiptAssetId: exp.receipt_asset_id,
        status: exp.status, splitMethod: exp.split_method,
        createdBy: exp.created_by, createdAt: exp.created_at, updatedAt: exp.updated_at,
      };

      const mappedItems: LineItem[] = (items ?? []).map((i: any) => ({
        id: i.id, expenseId: i.expense_id, name: i.name,
        quantity: parseFloat(i.quantity), unitPrice: parseFloat(i.unit_price),
        totalPrice: parseFloat(i.total_price), position: i.position,
      }));

      const mappedLips: LineItemParticipant[] = (lips ?? []).map((l: any) => ({
        id: l.id, lineItemId: l.line_item_id, userId: l.user_id,
        shares: parseFloat(l.shares),
      }));

      const mappedCharges: ChargeComponent[] = (charges ?? []).map((c: any) => ({
        id: c.id, expenseId: c.expense_id, type: c.type, label: c.label,
        amount: parseFloat(c.amount), rate: c.rate ? parseFloat(c.rate) : undefined,
        allocationRule: c.allocation_rule, excludedUserIds: c.excluded_user_ids ?? [],
        position: c.position,
      }));

      const mappedParticipants: ExpenseParticipant[] = participants.map((p: any) => ({
        id: p.id, expenseId: p.expense_id, userId: p.user_id,
        owedAmount: 0, paidAmount: parseFloat(p.paid_amount), isIncluded: p.is_included,
      }));

      const splitRule: SplitRule = {
        id: 'default', expenseId: exp.id, method: mappedExpense.splitMethod, overrides: {},
      };

      const result = computeSplit({
        expense: mappedExpense, lineItems: mappedItems,
        lineItemParticipants: mappedLips, chargeComponents: mappedCharges,
        splitRule, participants: mappedParticipants,
      });

      debts.push({
        expenseId: exp.id,
        paidBy: exp.paid_by,
        breakdown: result.breakdown.map((b) => ({
          userId: b.userId,
          totalOwed: b.totalOwed,
        })),
      });

      for (const p of participants) allUserIds.add(p.user_id);
    }

    // Fetch already-completed settlements and subtract from debts
    const { data: completedSettlements } = await supabase
      .from('settlements')
      .select('from_user_id, to_user_id, amount')
      .eq('group_id', groupId)
      .eq('status', 'completed');

    // Build a map of already-paid amounts: "from→to" → total paid
    const paidMap = new Map<string, number>();
    for (const s of completedSettlements ?? []) {
      const key = `${s.from_user_id}→${s.to_user_id}`;
      paidMap.set(key, (paidMap.get(key) ?? 0) + parseFloat(String(s.amount)));
    }

    // Compute group settlement
    const result = computeGroupSettlement(debts, group.settlement_mode);

    // Subtract already-paid amounts from each transfer
    const remaining = result.transfers
      .map((t) => {
        const key = `${t.fromUserId}→${t.toUserId}`;
        const alreadyPaid = paidMap.get(key) ?? 0;
        const leftover = Math.round((t.amount - alreadyPaid) * 100) / 100;
        return { ...t, amount: leftover };
      })
      .filter((t) => t.amount > 0.01); // Remove fully settled transfers

    setTransfers(remaining);

    // Fetch profile names
    if (allUserIds.size > 0) {
      const { data: profileRows } = await supabase
        .from('profiles')
        .select('id, display_name')
        .in('id', Array.from(allUserIds));
      const pMap: ProfileMap = {};
      for (const p of profileRows ?? []) pMap[p.id] = p.display_name;
      setProfiles(pMap);
    }

    setLoading(false);
  }

  async function handleMarkSettled(transfer: TraceableTransfer) {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { Alert.alert('Error', 'Not logged in'); return; }

      const { data: settlement, error } = await supabase.from('settlements').insert({
        group_id: groupId,
        from_user_id: transfer.fromUserId,
        to_user_id: transfer.toUserId,
        amount: transfer.amount,
        currency,
        status: 'completed',
        settled_at: new Date().toISOString(),
      }).select('id').single();

      if (error) {
        if (Platform.OS === 'web') window.alert('Error: ' + error.message);
        else Alert.alert('Error', error.message);
        return;
      }

      // Insert traceability links
      if (settlement) {
        for (const link of transfer.expenseLinks) {
          await supabase.from('settlement_expense_links').insert({
            settlement_id: settlement.id,
            expense_id: link.expenseId,
            amount_from_expense: link.amount,
          });

          // Check if this linked expense is now fully settled
          try {
            const { data: expRow } = await supabase
              .from('expenses')
              .select('paid_by')
              .eq('id', link.expenseId)
              .single();

            const { data: partRows } = await supabase
              .from('expense_participants')
              .select('user_id, owed_amount')
              .eq('expense_id', link.expenseId);

            const { data: links } = await supabase
              .from('settlement_expense_links')
              .select('amount_from_expense')
              .eq('expense_id', link.expenseId);

            if (expRow && partRows && links) {
              const totalDebt = partRows
                .filter((p: any) => p.user_id !== expRow.paid_by)
                .reduce((sum: number, p: any) => sum + parseFloat(p.owed_amount), 0);

              const totalSettled = links
                .reduce((sum: number, l: any) => sum + parseFloat(l.amount_from_expense), 0);

              if (totalSettled >= totalDebt - 0.01) {
                await supabase
                  .from('expenses')
                  .update({ status: 'settled' })
                  .eq('id', link.expenseId);
              }
            }
          } catch (err) {
            console.error('Error checking full settlement payoff:', err);
          }
        }
      }

      if (Platform.OS === 'web') window.alert('Payment marked as complete!');
      else Alert.alert('Settled', 'Payment marked as complete');
      load();
    } catch (e: any) {
      const msg = e?.message ?? 'Unknown error';
      if (Platform.OS === 'web') window.alert('Error: ' + msg);
      else Alert.alert('Error', msg);
    }
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

      {loading ? (
        <View style={styles.empty}>
          <Text style={styles.emptySubtitle}>Computing settlements...</Text>
        </View>
      ) : transfers.length === 0 ? (
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

            {t.expenseLinks.length > 0 && (
              <View style={styles.traceSection}>
                {t.expenseLinks.map((link, j) => (
                  <Text key={j} style={styles.traceText}>
                    {formatAmount(link.amount, currency)} from "{expenseNames[link.expenseId] ?? 'bill'}"
                  </Text>
                ))}
              </View>
            )}

            <Pressable
              style={({ pressed }) => [styles.settleBtn, pressed && { opacity: 0.7 }]}
              onPress={() => handleMarkSettled(t)}
            >
              <Text style={styles.settleBtnText}>Mark as paid</Text>
            </Pressable>
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
