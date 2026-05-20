import { useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { useLocalSearchParams, Stack } from 'expo-router';
import { useSession } from '@/providers/SessionProvider';
import { useGroupStats } from '@/hooks/useGroupStats';

function currentMonthWindow() {
  const now = new Date();
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const to = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
  return { from, to };
}

function monthLabel(from: string) {
  const d = new Date(from + 'T00:00:00');
  return d.toLocaleString('default', { month: 'long', year: 'numeric' });
}

function categoryLabel(cat: string): string {
  return cat.charAt(0).toUpperCase() + cat.slice(1);
}

function shareDeltaLabel(yours: number, avg: number, sym: string): { text: string; color: string } {
  const diff = yours - avg;
  if (Math.abs(diff) < 1) return { text: 'Right on the group average', color: '#6b7280' };
  if (diff > 0) return {
    text: `${sym}${diff.toFixed(2)} above group avg`,
    color: '#dc2626',
  };
  return {
    text: `${sym}${Math.abs(diff).toFixed(2)} below group avg`,
    color: '#16a34a',
  };
}

export default function GroupStatsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { session } = useSession();
  const { state, fetch } = useGroupStats();
  const window = currentMonthWindow();

  useEffect(() => {
    if (id && session?.user.id) fetch(id, session.user.id, window);
  }, [id, session?.user.id]);

  if (!session) return null;

  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title: 'Group Stats' }} />
        <ActivityIndicator size="large" color="#16a34a" />
        <Text style={styles.loadingText}>Loading group stats…</Text>
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title: 'Group Stats' }} />
        <Text style={styles.errorText}>Could not load stats: {state.message}</Text>
      </View>
    );
  }

  const { snapshot } = state;
  const title = snapshot ? snapshot.groupName : 'Group Stats';

  if (!snapshot) {
    return (
      <View style={styles.centered}>
        <Stack.Screen options={{ title }} />
        <Text style={styles.emptyTitle}>No bills this month</Text>
        <Text style={styles.emptySubtitle}>Add a bill to start tracking group spend.</Text>
      </View>
    );
  }

  const sym = snapshot.currency === 'INR' ? '₹' : '$';
  const delta = shareDeltaLabel(snapshot.yourShare, snapshot.avgSharePerPerson, sym);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Stack.Screen options={{ title: snapshot.groupName }} />

      <Text style={styles.heading}>{monthLabel(window.from)}</Text>
      <Text style={styles.subheading}>Group snapshot · {snapshot.billCount} bill{snapshot.billCount !== 1 ? 's' : ''}</Text>

      {/* Total group spend */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>TOTAL GROUP SPEND</Text>
        <Text style={styles.bigNumber}>{sym}{snapshot.totalGroupSpend.toFixed(2)}</Text>
        <Text style={styles.cardMeta}>{snapshot.participantCount} member{snapshot.participantCount !== 1 ? 's' : ''}</Text>
      </View>

      {/* Your share vs average */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>YOUR SHARE</Text>
        <View style={styles.shareRow}>
          <View style={styles.shareCol}>
            <Text style={styles.shareAmount}>{sym}{snapshot.yourShare.toFixed(2)}</Text>
            <Text style={styles.shareColLabel}>You</Text>
          </View>
          <View style={styles.shareDivider} />
          <View style={styles.shareCol}>
            <Text style={styles.shareAmount}>{sym}{snapshot.avgSharePerPerson.toFixed(2)}</Text>
            <Text style={styles.shareColLabel}>Group avg</Text>
          </View>
        </View>
        <Text style={[styles.deltaLabel, { color: delta.color }]}>{delta.text}</Text>
      </View>

      {/* Settlement streak */}
      <View style={styles.card}>
        <Text style={styles.cardLabel}>SETTLEMENT STREAK</Text>
        <View style={styles.streakRow}>
          <Text style={styles.streakNumber}>{snapshot.settlementStreak}</Text>
          <View style={styles.streakInfo}>
            <Text style={styles.streakDesc}>
              bill{snapshot.settlementStreak !== 1 ? 's' : ''} settled within 48 hrs in a row
            </Text>
            {snapshot.settlementStreak === 0 && (
              <Text style={styles.streakHint}>Settle bills faster to build your streak</Text>
            )}
          </View>
        </View>
      </View>

      {/* Top category */}
      {snapshot.topCategory && (
        <View style={styles.card}>
          <Text style={styles.cardLabel}>BIGGEST CATEGORY</Text>
          <View style={styles.categoryRow}>
            <Text style={styles.categoryName}>{categoryLabel(snapshot.topCategory)}</Text>
            <Text style={styles.categoryAmount}>{sym}{snapshot.topCategoryAmount.toFixed(2)}</Text>
          </View>
          <Text style={styles.categoryShare}>
            {snapshot.totalGroupSpend > 0
              ? `${Math.round((snapshot.topCategoryAmount / snapshot.totalGroupSpend) * 100)}% of group spend`
              : ''}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  content: { padding: 20, paddingBottom: 40 },
  centered: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  loadingText: { marginTop: 12, fontSize: 14, color: '#6b7280' },
  errorText: { fontSize: 14, color: '#dc2626', textAlign: 'center' },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#374151' },
  emptySubtitle: { fontSize: 14, color: '#9ca3af', marginTop: 6, textAlign: 'center' },

  heading: { fontSize: 22, fontWeight: '700', color: '#111827' },
  subheading: { fontSize: 14, color: '#6b7280', marginBottom: 20, marginTop: 2 },

  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 16,
    marginBottom: 14,
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowRadius: 6,
  },
  cardLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#9ca3af',
    letterSpacing: 0.8,
    marginBottom: 10,
  },
  cardMeta: { fontSize: 13, color: '#9ca3af', marginTop: 4 },

  bigNumber: { fontSize: 38, fontWeight: '700', color: '#111827' },

  shareRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  shareCol: { flex: 1, alignItems: 'center' },
  shareAmount: { fontSize: 24, fontWeight: '700', color: '#111827' },
  shareColLabel: { fontSize: 12, color: '#9ca3af', marginTop: 4 },
  shareDivider: { width: 1, height: 40, backgroundColor: '#e5e7eb' },
  deltaLabel: { fontSize: 13, fontWeight: '500', textAlign: 'center' },

  streakRow: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  streakNumber: { fontSize: 48, fontWeight: '700', color: '#111827', minWidth: 60 },
  streakInfo: { flex: 1 },
  streakDesc: { fontSize: 14, color: '#374151', lineHeight: 20 },
  streakHint: { fontSize: 12, color: '#9ca3af', marginTop: 4 },

  categoryRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  categoryName: { fontSize: 20, fontWeight: '700', color: '#111827' },
  categoryAmount: { fontSize: 20, fontWeight: '700', color: '#111827' },
  categoryShare: { fontSize: 13, color: '#9ca3af', marginTop: 6 },
});
