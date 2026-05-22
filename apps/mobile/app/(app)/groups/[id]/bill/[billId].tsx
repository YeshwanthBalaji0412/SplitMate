import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useMemo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { SplitInput, SplitRule } from '@splitmate/types';
import { computeSplit, formatAmount } from '@splitmate/split-engine';
import { useBillDetail } from '@/hooks/useBills';
import { useGroupMembers } from '@/hooks/useGroups';

/**
 * Bill detail / per-person breakdown screen.
 *
 * Reads owed_amount + paid_amount from expense_participants (the engine
 * already wrote real values during the assign-items confirm step).
 *
 * The breakdown entries (per-line tracing) are re-computed on render via
 * computeSplit so we get human-readable "Item X (sole claim)" / "Tax
 * (proportional)" labels for free without storing them in the DB. The
 * computed totals are double-checked against what's stored -- if they
 * drift more than a cent, we surface a warning (catches data corruption,
 * stale assignments, etc.).
 */
export default function BillDetailScreen() {
  const params = useLocalSearchParams<{ id: string; billId: string }>();
  const groupId = params.id;
  const billId = params.billId;

  const { bill, loading, error } = useBillDetail(billId);
  const { members } = useGroupMembers(groupId);

  const splitResult = useMemo(() => {
    if (!bill) return null;
    const rule: SplitRule = {
      id: `rule-${bill.expense.id}`,
      expenseId: bill.expense.id,
      method: bill.expense.splitMethod,
      overrides: {},
    };
    const input: SplitInput = {
      expense: bill.expense,
      lineItems: bill.items,
      lineItemParticipants: bill.lineItemParticipants,
      chargeComponents: bill.charges,
      splitRule: rule,
      participants: bill.participants,
    };
    return computeSplit(input);
  }, [bill]);

  if (loading || !bill) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }
  if (error || !splitResult) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>{error ?? 'Could not load bill.'}</Text>
      </View>
    );
  }

  const { expense, participants } = bill;
  const currency = expense.currency;

  // Map userId -> display name
  const nameOf = (uid: string) => {
    const m = members.find((mm) => mm.userId === uid);
    return m?.profile?.displayName ?? m?.profile?.email ?? uid.slice(0, 8);
  };

  const payerName = nameOf(expense.paidBy);

  // Reconciliation: stored sum vs computed sum.
  const storedTotal =
    Math.round(participants.reduce((s, p) => s + p.owedAmount, 0) * 100) / 100;
  const computedTotal =
    Math.round(splitResult.byUser.reduce((s, u) => s + u.totalOwed, 0) * 100) / 100;
  const driftCents = Math.round((computedTotal - storedTotal) * 100);

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Bill detail' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
        <View style={styles.headerCard}>
          <Text style={styles.title}>{expense.title}</Text>
          <Text style={styles.subtitle}>
            {expense.date} · {expense.billType} · paid by {payerName}
          </Text>
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalAmount}>{formatAmount(expense.totalAmount, currency)}</Text>
          </View>
        </View>

        {driftCents !== 0 && Math.abs(driftCents) > 1 ? (
          <View style={styles.warningCard}>
            <Text style={styles.warningText}>
              Stored vs computed totals differ by {formatAmount(driftCents / 100, currency)}.
              Re-confirm item assignments to fix.
            </Text>
          </View>
        ) : null}

        <Text style={styles.sectionHeader}>Per-person breakdown</Text>

        {splitResult.byUser.map((u) => {
          const storedRow = participants.find((p) => p.userId === u.userId);
          const isPayer = u.userId === expense.paidBy;
          return (
            <View key={u.userId} style={styles.userCard}>
              <View style={styles.userHeader}>
                <View>
                  <Text style={styles.userName}>{nameOf(u.userId)}</Text>
                  {isPayer ? <Text style={styles.payerTag}>paid the bill</Text> : null}
                </View>
                <Text style={styles.userTotal}>{formatAmount(u.totalOwed, currency)}</Text>
              </View>

              <View style={styles.entries}>
                {u.entries.map((e, i) => (
                  <View key={i} style={styles.entryRow}>
                    <View style={styles.entryTextCol}>
                      <Text style={styles.entryDescription}>{e.description}</Text>
                      {e.note ? <Text style={styles.entryNote}>{e.note}</Text> : null}
                    </View>
                    <Text
                      style={[
                        styles.entryAmount,
                        e.amount < 0 && styles.entryAmountNegative,
                      ]}
                    >
                      {formatAmount(e.amount, currency)}
                    </Text>
                  </View>
                ))}
              </View>

              {storedRow ? (
                <View style={styles.storedRow}>
                  <Text style={styles.storedLabel}>Stored owed</Text>
                  <Text style={styles.storedValue}>
                    {formatAmount(storedRow.owedAmount, currency)}
                  </Text>
                </View>
              ) : null}
            </View>
          );
        })}

        <Pressable
          style={({ pressed }) => [styles.linkBtn, pressed && styles.linkBtnPressed]}
          onPress={() =>
            router.push({
              pathname: '/(app)/groups/[id]/assign-items',
              params: { id: groupId, expenseId: billId },
            })
          }
        >
          <Text style={styles.linkBtnText}>Edit item assignments</Text>
        </Pressable>
      </ScrollView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  scroll: { padding: 16, gap: 10, paddingBottom: 32 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f9fafb',
  },
  errorText: { color: '#dc2626' },
  headerCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 18,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 1,
  },
  title: { fontSize: 22, fontWeight: '700', color: '#111111' },
  subtitle: { fontSize: 13, color: '#6b7280', marginTop: 4, textTransform: 'capitalize' },
  totalRow: {
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e5e7eb',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  totalLabel: { fontSize: 14, color: '#6b7280' },
  totalAmount: { fontSize: 22, fontWeight: '700', color: '#111111' },

  warningCard: {
    backgroundColor: '#fef3c7',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#fbbf24',
  },
  warningText: { color: '#92400e', fontSize: 13 },

  sectionHeader: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6b7280',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 4,
    marginLeft: 4,
  },

  userCard: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 16,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 1,
  },
  userHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-end',
    marginBottom: 6,
  },
  userName: { fontSize: 17, fontWeight: '600', color: '#111111' },
  payerTag: { fontSize: 11, color: '#6b7280', marginTop: 2 },
  userTotal: { fontSize: 18, fontWeight: '700', color: '#111111' },

  entries: { marginTop: 6, gap: 6 },
  entryRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  entryTextCol: { flex: 1 },
  entryDescription: { fontSize: 14, color: '#111111' },
  entryNote: { fontSize: 11, color: '#9ca3af', marginTop: 1 },
  entryAmount: { fontSize: 14, color: '#111111', fontVariant: ['tabular-nums'] },
  entryAmountNegative: { color: '#15803d' },

  storedRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 10,
    paddingTop: 10,
    borderTopWidth: 1,
    borderTopColor: '#f3f4f6',
  },
  storedLabel: { fontSize: 11, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: 0.5 },
  storedValue: { fontSize: 13, color: '#374151' },

  linkBtn: {
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  linkBtnPressed: { opacity: 0.6 },
  linkBtnText: { color: '#16a34a', fontWeight: '500' },
});
