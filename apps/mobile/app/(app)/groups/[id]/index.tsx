import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  Share,
} from 'react-native';
import { router, useLocalSearchParams, Stack } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { formatAmount } from '@split-smart/split-engine';

interface GroupDetail {
  id: string;
  name: string;
  currency: string;
  country: string;
  invite_code: string;
  settlement_mode: string;
}

interface ExpenseRow {
  id: string;
  title: string;
  total_amount: number;
  currency: string;
  bill_type: string;
  date: string;
  status: string;
  paid_by: string;
  profiles: { display_name: string } | null;
}

export default function GroupDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [group, setGroup] = useState<GroupDetail | null>(null);
  const [expenses, setExpenses] = useState<ExpenseRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchData = useCallback(async () => {
    if (!id) return;

    const [{ data: g }, { data: e }] = await Promise.all([
      supabase.from('groups').select('id, name, currency, country, invite_code, settlement_mode').eq('id', id).single(),
      supabase
        .from('expenses')
        .select('id, title, total_amount, currency, bill_type, date, status, paid_by, profiles!expenses_paid_by_fkey(display_name)')
        .eq('group_id', id)
        .order('date', { ascending: false }),
    ]);

    if (g) setGroup(g);
    if (e) setExpenses(e as unknown as ExpenseRow[]);
  }, [id]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchData();
    setRefreshing(false);
  };

  const shareInvite = async () => {
    if (!group) return;
    await Share.share({
      message: `Join "${group.name}" on SplitMate! Use invite code: ${group.invite_code}`,
    });
  };

  if (!group) return null;

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ title: group.name }} />

      <View style={styles.header}>
        <TouchableOpacity style={styles.inviteBtn} onPress={shareInvite}>
          <Text style={styles.inviteText}>Invite: {group.invite_code}</Text>
        </TouchableOpacity>
        <View style={styles.headerActions}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => router.push(`/(app)/groups/${id}/bill-entry`)}
          >
            <Text style={styles.actionText}>+ Add Bill</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.settleBtn]}
            onPress={() => router.push(`/(app)/groups/${id}/settle`)}
          >
            <Text style={[styles.actionText, styles.settleText]}>Settle Up</Text>
          </TouchableOpacity>
        </View>
        <TouchableOpacity
          style={styles.statsBtn}
          onPress={() => router.push(`/(app)/groups/${id}/group-stats`)}
        >
          <Text style={styles.statsText}>Group Stats</Text>
        </TouchableOpacity>
      </View>

      {expenses.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No bills yet</Text>
          <Text style={styles.emptySubtitle}>Add your first bill to start splitting</Text>
        </View>
      ) : (
        <FlatList
          data={expenses}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#16a34a" />}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.expenseCard}
              onPress={() => router.push(`/(app)/groups/${id}/bill/${item.id}`)}
            >
              <View style={styles.expenseInfo}>
                <Text style={styles.expenseTitle}>{item.title}</Text>
                <Text style={styles.expenseMeta}>
                  {item.bill_type} · {item.date} · paid by {item.profiles?.display_name ?? 'Unknown'}
                </Text>
              </View>
              <View style={styles.expenseRight}>
                <Text style={styles.expenseAmount}>
                  {formatAmount(item.total_amount, item.currency)}
                </Text>
                <Text style={[styles.status, item.status === 'settled' && styles.statusSettled]}>
                  {item.status}
                </Text>
              </View>
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  header: { padding: 16, gap: 12 },
  inviteBtn: { backgroundColor: '#f3f4f6', borderRadius: 8, padding: 10, alignItems: 'center' },
  inviteText: { fontSize: 13, color: '#6b7280', fontWeight: '500', letterSpacing: 0.5 },
  headerActions: { flexDirection: 'row', gap: 10 },
  actionBtn: { flex: 1, backgroundColor: '#16a34a', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  actionText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  settleBtn: { backgroundColor: '#2563eb' },
  settleText: { color: '#fff' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#374151' },
  emptySubtitle: { fontSize: 14, color: '#9ca3af', marginTop: 6 },
  list: { padding: 16 },
  expenseCard: { backgroundColor: '#fff', borderRadius: 12, padding: 14, marginBottom: 10, flexDirection: 'row', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6 },
  expenseInfo: { flex: 1 },
  expenseTitle: { fontSize: 15, fontWeight: '600', color: '#111827' },
  expenseMeta: { fontSize: 12, color: '#9ca3af', marginTop: 3 },
  expenseRight: { alignItems: 'flex-end' },
  expenseAmount: { fontSize: 15, fontWeight: '700', color: '#111827' },
  status: { fontSize: 11, color: '#f59e0b', fontWeight: '600', marginTop: 3, textTransform: 'uppercase' },
  statusSettled: { color: '#16a34a' },
  statsBtn: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#fff',
  },
  statsText: { fontSize: 14, fontWeight: '500', color: '#374151' },
});
