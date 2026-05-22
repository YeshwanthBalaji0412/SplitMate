import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { formatAmount } from '@splitmate/split-engine';
import { useBillDetail } from '@/hooks/useBills';
import { useGroupMembers } from '@/hooks/useGroups';
import { applyAssignmentsAndCompute, type ItemAssignment } from '@/hooks/useExpenseSplit';

/**
 * Per-item claimant assignment. Each item shows the included participants
 * as chips; tapping a chip toggles that user's claim with shares=1.
 *
 * MVP simplification: shares are always 1 (sole or 1+1+... shared). Uneven
 * splits (2/3 of a pizza, etc.) come in a later phase via long-press / count
 * input. The engine already supports uneven shares -- only the UI is gated.
 */
export default function AssignItemsScreen() {
  const params = useLocalSearchParams<{ id: string; expenseId: string }>();
  const groupId = params.id;
  const expenseId = params.expenseId;

  const { bill, loading, error } = useBillDetail(expenseId);
  const { members } = useGroupMembers(groupId);

  // claims[itemId] = Set of userId
  const [claims, setClaims] = useState<Record<string, Set<string>>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // Initialize claim state once the bill loads.
  useEffect(() => {
    if (!bill) return;
    const initial: Record<string, Set<string>> = {};
    for (const it of bill.items) {
      const claimers = bill.lineItemParticipants
        .filter((lp) => lp.lineItemId === it.id)
        .map((lp) => lp.userId);
      initial[it.id] = new Set(claimers);
    }
    setClaims(initial);
  }, [bill]);

  const includedUserIds = useMemo(
    () => new Set((bill?.participants ?? []).filter((p) => p.isIncluded).map((p) => p.userId)),
    [bill],
  );

  const includedMembers = useMemo(
    () => members.filter((m) => includedUserIds.has(m.userId)),
    [members, includedUserIds],
  );

  if (loading || !bill) {
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

  function toggleClaim(itemId: string, userId: string) {
    setClaims((prev) => {
      const cur = new Set(prev[itemId] ?? []);
      if (cur.has(userId)) cur.delete(userId);
      else cur.add(userId);
      return { ...prev, [itemId]: cur };
    });
  }

  async function handleConfirm() {
    setSubmitError(null);
    if (!bill) return;

    const assignments: ItemAssignment[] = bill.items.map((it) => {
      const claimers = Array.from(claims[it.id] ?? []);
      return {
        lineItemId: it.id,
        claimants: claimers.map((uid) => ({ userId: uid, shares: 1 })),
      };
    });

    setSubmitting(true);
    const result = await applyAssignmentsAndCompute(expenseId, assignments);
    setSubmitting(false);

    if (!result.ok) {
      setSubmitError(result.error);
      return;
    }

    router.replace({
      pathname: '/(app)/groups/[id]/bill/[billId]',
      params: { id: groupId, billId: expenseId },
    });
  }

  const currency = bill.expense.currency;

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Assign items' }} />
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>{bill.expense.title}</Text>
          <Text style={styles.headerSubtitle}>
            Tap each member who shared this item. Unassigned items split equally.
          </Text>
        </View>

        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          {bill.items.length === 0 ? (
            <View style={styles.card}>
              <Text style={styles.emptyTitle}>No items on this bill</Text>
              <Text style={styles.emptyHint}>
                The split engine will allocate charges across all included members.
              </Text>
            </View>
          ) : (
            bill.items.map((it) => {
              const claimers = claims[it.id] ?? new Set<string>();
              return (
                <View key={it.id} style={styles.card}>
                  <View style={styles.itemHeader}>
                    <Text style={styles.itemName}>{it.name}</Text>
                    <Text style={styles.itemPrice}>{formatAmount(it.totalPrice, currency)}</Text>
                  </View>
                  <Text style={styles.itemHint}>
                    {claimers.size === 0
                      ? 'Unclaimed (will split equally)'
                      : claimers.size === 1
                        ? 'Sole claim'
                        : `Shared between ${claimers.size} people`}
                  </Text>
                  <View style={styles.chipRow}>
                    {includedMembers.map((m) => {
                      const claimed = claimers.has(m.userId);
                      const name = m.profile?.displayName ?? m.profile?.email ?? '?';
                      return (
                        <Pressable
                          key={m.userId}
                          style={[styles.chip, claimed && styles.chipActive]}
                          onPress={() => toggleClaim(it.id, m.userId)}
                          disabled={submitting}
                        >
                          <Text style={[styles.chipText, claimed && styles.chipTextActive]}>
                            {name}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              );
            })
          )}

          {submitError ? <Text style={styles.error}>{submitError}</Text> : null}
        </ScrollView>

        <View style={styles.footer}>
          <Pressable
            style={({ pressed }) => [
              styles.primaryBtn,
              (submitting || pressed) && styles.primaryBtnPressed,
            ]}
            onPress={handleConfirm}
            disabled={submitting}
          >
            {submitting ? (
              <ActivityIndicator color="#ffffff" />
            ) : (
              <Text style={styles.primaryBtnText}>Confirm &amp; compute</Text>
            )}
          </Pressable>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f9fafb',
  },
  errorText: { color: '#dc2626' },
  header: {
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
    gap: 4,
  },
  headerTitle: { fontSize: 20, fontWeight: '700', color: '#111111' },
  headerSubtitle: { fontSize: 13, color: '#6b7280' },
  scroll: { padding: 16, gap: 10, paddingBottom: 32 },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 14,
    padding: 16,
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 1,
  },
  itemHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  itemName: { fontSize: 16, fontWeight: '600', color: '#111111', flex: 1 },
  itemPrice: { fontSize: 15, color: '#111111', fontWeight: '500' },
  itemHint: { fontSize: 12, color: '#6b7280', textTransform: 'lowercase' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  chip: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
    backgroundColor: '#ffffff',
  },
  chipActive: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  chipText: { fontSize: 13, color: '#374151' },
  chipTextActive: { color: '#ffffff', fontWeight: '600' },
  emptyTitle: { fontSize: 15, fontWeight: '600', color: '#111111' },
  emptyHint: { fontSize: 13, color: '#6b7280' },
  error: { color: '#dc2626', fontSize: 14, textAlign: 'center', marginTop: 8 },
  footer: { padding: 16, backgroundColor: '#f9fafb' },
  primaryBtn: {
    backgroundColor: '#16a34a',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnPressed: { opacity: 0.85 },
  primaryBtnText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
});
