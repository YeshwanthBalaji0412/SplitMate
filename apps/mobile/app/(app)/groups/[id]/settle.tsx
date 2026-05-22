import { Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { TraceableTransfer } from '@splitmate/types';
import { formatAmount } from '@splitmate/split-engine';
import { useAuth } from '@/hooks/useAuth';
import { useBillsInGroup } from '@/hooks/useBills';
import { useGroup, useGroupMembers } from '@/hooks/useGroups';
import { markTransferPaid, useGroupSettlement } from '@/hooks/useSettlements';

/**
 * Settlement screen: lists the outstanding transfers needed to clear all
 * active bills in the group. Each card shows debtor -> creditor + amount
 * + the source bills it covers, with a "Mark as paid" action enabled
 * only for the debtor side of that specific transfer.
 */
export default function SettleScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const groupId = params.id;

  const { user } = useAuth();
  const { group } = useGroup(groupId);
  const { members } = useGroupMembers(groupId);
  const { bills } = useBillsInGroup(groupId);
  const { transfers, loading, error, refresh } = useGroupSettlement(groupId);

  const [markingId, setMarkingId] = useState<string | null>(null);
  const [markError, setMarkError] = useState<string | null>(null);

  // Refetch when the screen regains focus (e.g. after returning from bill detail).
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  const nameOf = (uid: string) => {
    const m = members.find((mm) => mm.userId === uid);
    return m?.profile?.displayName ?? m?.profile?.email ?? uid.slice(0, 8);
  };

  const billTitleOf = (expenseId: string) => {
    return bills.find((b) => b.id === expenseId)?.title ?? expenseId.slice(0, 8);
  };

  async function handleMarkPaid(t: TraceableTransfer, key: string) {
    if (!groupId) return;
    setMarkError(null);
    setMarkingId(key);
    const result = await markTransferPaid(t, groupId);
    setMarkingId(null);
    if (!result.ok) {
      if (Platform.OS === 'web') window.alert(`Failed: ${result.error}`);
      else Alert.alert('Failed to mark paid', result.error);
      setMarkError(result.error);
      return;
    }
    await refresh();
  }

  if (!group || loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error}</Text>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Settle up' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
        <View style={styles.headerCard}>
          <Text style={styles.headerTitle}>Outstanding transfers</Text>
          <Text style={styles.headerSubtitle}>
            Mode: {group.settlementMode} · {group.currency} · {transfers.length} transfer
            {transfers.length === 1 ? '' : 's'}
          </Text>
        </View>

        {transfers.length === 0 ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>All settled!</Text>
            <Text style={styles.emptyHint}>
              No outstanding balances. Add a new bill or come back after the next one.
            </Text>
          </View>
        ) : (
          transfers.map((t, idx) => {
            const key = `${t.fromUserId}-${t.toUserId}-${idx}`;
            const isYours = user?.id === t.fromUserId;
            const submitting = markingId === key;
            return (
              <View key={key} style={styles.transferCard}>
                <View style={styles.transferTop}>
                  <View style={styles.namesCol}>
                    <Text style={styles.fromName}>{nameOf(t.fromUserId)}</Text>
                    <Text style={styles.arrow}>↓ pays</Text>
                    <Text style={styles.toName}>{nameOf(t.toUserId)}</Text>
                  </View>
                  <Text style={styles.amount}>{formatAmount(t.amount, t.currency)}</Text>
                </View>

                {t.expenseLinks.length > 0 ? (
                  <View style={styles.linksBlock}>
                    <Text style={styles.linksLabel}>covers</Text>
                    {t.expenseLinks.map((l) => (
                      <View key={l.expenseId} style={styles.linkRow}>
                        <Text style={styles.linkTitle} numberOfLines={1}>
                          {billTitleOf(l.expenseId)}
                        </Text>
                        <Text style={styles.linkAmount}>
                          {formatAmount(l.amount, t.currency)}
                        </Text>
                      </View>
                    ))}
                  </View>
                ) : null}

                <Pressable
                  style={({ pressed }) => [
                    styles.payBtn,
                    !isYours && styles.payBtnDisabled,
                    (submitting || pressed) && isYours && styles.payBtnPressed,
                  ]}
                  onPress={() => handleMarkPaid(t, key)}
                  disabled={!isYours || submitting}
                >
                  {submitting ? (
                    <ActivityIndicator color="#ffffff" />
                  ) : (
                    <Text style={styles.payBtnText}>
                      {isYours ? 'Mark as paid' : `Waiting for ${nameOf(t.fromUserId)}`}
                    </Text>
                  )}
                </Pressable>
              </View>
            );
          })
        )}

        {markError ? <Text style={styles.error}>{markError}</Text> : null}
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  scroll: { padding: 16, gap: 12, paddingBottom: 32 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f9fafb',
  },
  errorText: { color: '#dc2626' },

  headerCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 1,
  },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#111111' },
  headerSubtitle: { fontSize: 13, color: '#6b7280', marginTop: 4, textTransform: 'capitalize' },

  emptyCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 32,
    alignItems: 'center',
    gap: 6,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 1,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#16a34a' },
  emptyHint: { fontSize: 13, color: '#6b7280', textAlign: 'center' },

  transferCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 18,
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 1,
  },
  transferTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  namesCol: { flex: 1, gap: 2 },
  fromName: { fontSize: 16, fontWeight: '600', color: '#111111' },
  arrow: { fontSize: 12, color: '#6b7280' },
  toName: { fontSize: 16, fontWeight: '600', color: '#111111' },
  amount: { fontSize: 22, fontWeight: '700', color: '#111111', fontVariant: ['tabular-nums'] },

  linksBlock: {
    backgroundColor: '#f9fafb',
    borderRadius: 10,
    padding: 12,
    gap: 6,
  },
  linksLabel: {
    fontSize: 11,
    color: '#9ca3af',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  linkRow: { flexDirection: 'row', justifyContent: 'space-between' },
  linkTitle: { fontSize: 14, color: '#374151', flex: 1 },
  linkAmount: { fontSize: 14, color: '#374151', fontVariant: ['tabular-nums'] },

  payBtn: {
    backgroundColor: '#16a34a',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  payBtnPressed: { opacity: 0.85 },
  payBtnDisabled: { backgroundColor: '#e5e7eb' },
  payBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },

  error: { color: '#dc2626', fontSize: 14, textAlign: 'center' },
});
