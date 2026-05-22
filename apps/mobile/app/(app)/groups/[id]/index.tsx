import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useCallback } from 'react';
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
import type { Expense } from '@splitmate/types';
import { formatAmount } from '@splitmate/split-engine';
import { formatInviteCodeForDisplay } from '@/lib/inviteCode';
import { useBillsInGroup } from '@/hooks/useBills';
import { useGroup, useGroupMembers, type GroupMemberWithProfile } from '@/hooks/useGroups';

function comingSoon(feature: string, phase: string) {
  const msg = `${feature} ships in ${phase}.`;
  if (Platform.OS === 'web') {
    window.alert(msg);
  } else {
    Alert.alert('Coming soon', msg);
  }
}

export default function GroupHomeScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const groupId = params.id;

  const { group, loading: gLoading, error: gError } = useGroup(groupId);
  const { members, loading: mLoading } = useGroupMembers(groupId);
  const { bills, refresh: refreshBills } = useBillsInGroup(groupId);

  // Refresh the bills list whenever the screen regains focus (after creating a new one).
  useFocusEffect(
    useCallback(() => {
      refreshBills();
    }, [refreshBills]),
  );

  const loading = gLoading || mLoading;

  if (loading && !group) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (gError) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Couldn't load group: {gError}</Text>
        <Pressable style={styles.linkBtn} onPress={() => router.replace('/(app)/dashboard')}>
          <Text style={styles.linkBtnText}>Back to dashboard</Text>
        </Pressable>
      </View>
    );
  }

  if (!group) {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Group not found.</Text>
        <Pressable style={styles.linkBtn} onPress={() => router.replace('/(app)/dashboard')}>
          <Text style={styles.linkBtnText}>Back to dashboard</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: group.name }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
        {/* Header */}
        <View style={styles.headerCard}>
          <Text style={styles.groupName}>{group.name}</Text>
          <View style={styles.badgeRow}>
            <Badge label={`${group.country} · ${group.currency}`} />
            <Badge label={group.type} />
            <Badge label={`Settle: ${group.settlementMode}`} />
          </View>
        </View>

        {/* Invite code */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Invite a friend</Text>
          <Text style={styles.sectionSubtitle}>Share this code so they can join the group.</Text>
          <View style={styles.codeBox}>
            <Text style={styles.codeText}>{formatInviteCodeForDisplay(group.inviteCode)}</Text>
          </View>
        </View>

        {/* Members */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Members ({members.length})</Text>
          {members.length === 0 ? (
            <Text style={styles.sectionSubtitle}>No members yet.</Text>
          ) : (
            <View style={styles.memberList}>
              {members.map((m) => (
                <MemberRow key={m.id} member={m} />
              ))}
            </View>
          )}
        </View>

        {/* Bills */}
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Bills ({bills.length})</Text>
          {bills.length === 0 ? (
            <Text style={styles.sectionSubtitle}>No bills yet. Add one to start splitting.</Text>
          ) : (
            <View style={styles.billList}>
              {bills.map((b) => (
                <BillRow
                  key={b.id}
                  bill={b}
                  currency={group.currency}
                  onPress={() =>
                    router.push({
                      pathname: '/(app)/groups/[id]/bill/[billId]',
                      params: { id: groupId, billId: b.id },
                    })
                  }
                />
              ))}
            </View>
          )}
        </View>

        {/* Actions */}
        <View style={styles.actionStack}>
          <Pressable
            style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
            onPress={() =>
              router.push({
                pathname: '/(app)/groups/[id]/bill-entry',
                params: { id: groupId },
              })
            }
          >
            <Text style={styles.primaryBtnText}>Add Bill</Text>
          </Pressable>

          <View style={styles.secondaryRow}>
            <Pressable
              style={({ pressed }) => [styles.secondaryBtn, pressed && styles.secondaryBtnPressed]}
              onPress={() =>
                router.push({ pathname: '/(app)/groups/[id]/settle', params: { id: groupId } })
              }
            >
              <Text style={styles.secondaryBtnText}>Settle Up</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.secondaryBtn, pressed && styles.secondaryBtnPressed]}
              onPress={() => comingSoon('Group analytics', 'Phase 14')}
            >
              <Text style={styles.secondaryBtnText}>Group Stats</Text>
            </Pressable>
          </View>
        </View>
      </ScrollView>
    </>
  );
}

function Badge({ label }: { label: string }) {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

function MemberRow({ member }: { member: GroupMemberWithProfile }) {
  const name = member.profile?.displayName ?? member.profile?.email ?? 'Unknown user';
  const initial = name.charAt(0).toUpperCase();
  return (
    <View style={styles.memberRow}>
      <View style={styles.avatar}>
        <Text style={styles.avatarText}>{initial}</Text>
      </View>
      <View style={styles.memberInfo}>
        <Text style={styles.memberName}>{name}</Text>
        {member.role === 'owner' ? <Text style={styles.memberRole}>owner</Text> : null}
      </View>
    </View>
  );
}

function BillRow({
  bill,
  currency,
  onPress,
}: {
  bill: Expense;
  currency: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      style={({ pressed }) => [styles.billRow, pressed && styles.billRowPressed]}
      onPress={onPress}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.billTitle}>{bill.title}</Text>
        <Text style={styles.billMeta}>
          {bill.date} · {bill.billType}
          {bill.status === 'settled' ? ' · settled' : ''}
        </Text>
      </View>
      <Text style={styles.billAmount}>{formatAmount(bill.totalAmount, currency)}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  scroll: { padding: 16, gap: 12 },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#f9fafb',
    padding: 24,
    gap: 12,
  },
  errorText: { color: '#dc2626', textAlign: 'center' },
  linkBtn: { padding: 12 },
  linkBtnText: { color: '#16a34a', fontWeight: '500' },

  headerCard: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 2,
  },
  groupName: { fontSize: 24, fontWeight: '700', color: '#111111', marginBottom: 8 },
  badgeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  badge: {
    backgroundColor: '#f3f4f6',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  badgeText: { fontSize: 12, color: '#374151', textTransform: 'capitalize' },

  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 20,
    gap: 6,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 2,
  },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#111111' },
  sectionSubtitle: { fontSize: 13, color: '#6b7280' },

  codeBox: {
    backgroundColor: '#f3f4f6',
    borderRadius: 10,
    padding: 14,
    marginTop: 8,
    alignItems: 'center',
  },
  codeText: {
    fontSize: 18,
    color: '#111111',
    letterSpacing: 1,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },

  memberList: { gap: 10, marginTop: 6 },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  avatar: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#16a34a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: '#ffffff', fontWeight: '600', fontSize: 14 },
  memberInfo: { flex: 1 },
  memberName: { fontSize: 15, color: '#111111', fontWeight: '500' },
  memberRole: { fontSize: 11, color: '#6b7280', textTransform: 'uppercase', letterSpacing: 0.5 },

  billList: { gap: 8, marginTop: 6 },
  billRow: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#f9fafb',
  },
  billRowPressed: { backgroundColor: '#f3f4f6' },
  billTitle: { fontSize: 15, fontWeight: '500', color: '#111111' },
  billMeta: { fontSize: 12, color: '#6b7280', marginTop: 2, textTransform: 'capitalize' },
  billAmount: { fontSize: 15, fontWeight: '600', color: '#111111', fontVariant: ['tabular-nums'] },

  actionStack: { gap: 10, marginTop: 4 },
  primaryBtn: {
    backgroundColor: '#16a34a',
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
  },
  primaryBtnPressed: { opacity: 0.85 },
  primaryBtnText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
  secondaryRow: { flexDirection: 'row', gap: 10 },
  secondaryBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  secondaryBtnPressed: { backgroundColor: '#f3f4f6' },
  secondaryBtnText: { color: '#111111', fontSize: 14, fontWeight: '500' },
});
