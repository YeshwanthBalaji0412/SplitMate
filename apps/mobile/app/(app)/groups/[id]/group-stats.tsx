import { Stack, useLocalSearchParams } from 'expo-router';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { formatAmount } from '@splitmate/split-engine';
import { useAuth } from '@/hooks/useAuth';
import { useGroup } from '@/hooks/useGroups';
import { useGroupStats } from '@/hooks/useGroupStats';

export default function GroupStatsScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  const groupId = params.id;
  const { user } = useAuth();
  const { group } = useGroup(groupId);
  const { stats, loading } = useGroupStats(groupId, user?.id);

  if (loading || !group) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  if (!stats || stats.groupTotalSpend === 0) {
    return (
      <>
        <Stack.Screen options={{ headerShown: true, title: 'Group Stats' }} />
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>No bills this month</Text>
          <Text style={styles.emptyHint}>Group stats appear once bills are added.</Text>
        </View>
      </>
    );
  }

  const currency = group.currency;
  const delta = stats.userShare - stats.avgSharePerMember;
  const deltaSign = delta > 0.01 ? '+' : delta < -0.01 ? '' : '';
  const deltaColor = delta > 0.01 ? '#dc2626' : delta < -0.01 ? '#16a34a' : '#6b7280';

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Group Stats' }} />
      <View style={styles.container}>
        <View style={styles.grid}>
          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{formatAmount(stats.groupTotalSpend, currency)}</Text>
            <Text style={styles.metricLabel}>Group total this month</Text>
          </View>

          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>{formatAmount(stats.userShare, currency)}</Text>
            <Text style={[styles.metricDelta, { color: deltaColor }]}>
              {deltaSign}{formatAmount(delta, currency)} vs avg
            </Text>
            <Text style={styles.metricLabel}>Your share</Text>
          </View>

          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>
              {stats.settlementStreak > 0
                ? `${stats.settlementStreak} bill${stats.settlementStreak === 1 ? '' : 's'}`
                : '—'}
            </Text>
            <Text style={styles.metricLabel}>Settlement streak</Text>
            {stats.settlementStreak === 0 && (
              <Text style={styles.metricHint}>Settle a bill within 48h to start</Text>
            )}
          </View>

          <View style={styles.metricCard}>
            <Text style={styles.metricValue}>
              {stats.topCategory ?? '—'}
            </Text>
            <Text style={styles.metricLabel}>Top category</Text>
          </View>
        </View>

        <Text style={styles.footer}>
          {stats.memberCount} member{stats.memberCount === 1 ? '' : 's'} · avg share{' '}
          {formatAmount(stats.avgSharePerMember, currency)}
        </Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb', padding: 16, gap: 16 },
  centered: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#f9fafb', padding: 24, gap: 8,
  },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#111' },
  emptyHint: { fontSize: 13, color: '#6b7280', textAlign: 'center' },

  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  metricCard: {
    width: '47%' as unknown as number,
    backgroundColor: '#fff', borderRadius: 14, padding: 18, gap: 4,
    shadowColor: '#000', shadowOpacity: 0.04, shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8, elevation: 1,
  },
  metricValue: { fontSize: 20, fontWeight: '700', color: '#111', textTransform: 'capitalize' },
  metricDelta: { fontSize: 13, fontWeight: '600' },
  metricLabel: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  metricHint: { fontSize: 11, color: '#9ca3af', marginTop: 2 },

  footer: { color: '#6b7280', fontSize: 13, textAlign: 'center', marginTop: 8 },
});
