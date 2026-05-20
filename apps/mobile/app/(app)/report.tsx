import { useEffect } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  Alert,
  Share,
} from 'react-native';
import * as FileSystem from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useSession } from '@/providers/SessionProvider';
import { useBillRecords } from '@/hooks/useBillRecords';
import { computeMonthlyReport, exportToJSON, exportToCSV } from '@split-smart/analytics';

function currentMonthWindow() {
  const now = new Date();
  const from = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`;
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const to = `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`;
  return { from, to };
}

function monthLabel(window: { from: string }) {
  const d = new Date(window.from + 'T00:00:00');
  return d.toLocaleString('default', { month: 'long', year: 'numeric' });
}

export default function ReportScreen() {
  const { session } = useSession();
  const { state, fetch } = useBillRecords();
  const window = currentMonthWindow();

  useEffect(() => {
    if (session?.user.id) fetch(session.user.id, window);
  }, [session?.user.id]);

  if (!session) return null;

  if (state.status === 'idle' || state.status === 'loading') {
    return (
      <View style={styles.centered}>
        <ActivityIndicator size="large" color="#16a34a" />
        <Text style={styles.loadingText}>Building your report…</Text>
      </View>
    );
  }

  if (state.status === 'error') {
    return (
      <View style={styles.centered}>
        <Text style={styles.errorText}>Could not load report: {state.message}</Text>
      </View>
    );
  }

  const userId = session.user.id;
  const report = computeMonthlyReport(userId, state.records, window);
  const sym = report.currency === 'INR' ? '₹' : '$';

  async function handleExport(format: 'json' | 'csv') {
    if (state.status !== 'done') return;
    try {
      const content = format === 'json'
        ? exportToJSON(userId, report, state.records)
        : exportToCSV(userId, report, state.records);
      const ext = format === 'json' ? 'json' : 'csv';
      const filename = `splitmate-report-${window.from.slice(0, 7)}.${ext}`;
      const path = `${FileSystem.documentDirectory}${filename}`;
      await FileSystem.writeAsStringAsync(path, content, { encoding: FileSystem.EncodingType.UTF8 });
      await Sharing.shareAsync(path, { mimeType: format === 'json' ? 'application/json' : 'text/csv' });
    } catch {
      Alert.alert('Export failed', 'Could not export the report.');
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.heading}>{monthLabel(window)}</Text>
      <Text style={styles.subheading}>Your spending summary</Text>

      {/* Top-level totals */}
      <View style={styles.card}>
        <View style={styles.totalRow}>
          <View>
            <Text style={styles.totalLabel}>Total spent</Text>
            <Text style={styles.totalAmount}>{sym}{report.totalSpent.toFixed(2)}</Text>
          </View>
          <View style={styles.totalRight}>
            <Text style={styles.metaLabel}>{report.totalBills} bill{report.totalBills !== 1 ? 's' : ''}</Text>
            <Text style={styles.metaLabel}>{report.groupsInvolved} group{report.groupsInvolved !== 1 ? 's' : ''}</Text>
          </View>
        </View>
      </View>

      {/* Category breakdown */}
      {report.byCategory.length > 0 && (
        <View style={styles.card}>
          <Text style={styles.cardTitle}>By category</Text>
          {report.byCategory.map((cat) => (
            <View key={cat.billType} style={styles.catRow}>
              <View style={styles.catLeft}>
                <Text style={styles.catName}>{cat.billType.charAt(0).toUpperCase() + cat.billType.slice(1)}</Text>
                <Text style={styles.catCount}>{cat.billCount} bill{cat.billCount !== 1 ? 's' : ''}</Text>
              </View>
              <View style={styles.catRight}>
                <Text style={styles.catAmount}>{sym}{cat.totalSpent.toFixed(2)}</Text>
                <View style={styles.catBarBg}>
                  <View style={[styles.catBar, { width: `${cat.percentOfTotal}%` }]} />
                </View>
              </View>
            </View>
          ))}
        </View>
      )}

      {/* Fairness — gated at 8 bills */}
      {report.totalBills === 0 ? null : report.totalBills < 8 ? (
        <View style={styles.card}>
          <View style={styles.fairnessHeaderRow}>
            <Text style={styles.fairnessTitle}>YOUR SHARE PATTERN</Text>
          </View>
          <View style={styles.fairnessProgressBg}>
            <View style={[styles.fairnessProgressFill, { width: `${(report.totalBills / 8) * 100}%` }]} />
          </View>
          <Text style={styles.fairnessLockedText}>
            {8 - report.totalBills} more bill{8 - report.totalBills !== 1 ? 's' : ''} this month to unlock your share insight
          </Text>
        </View>
      ) : (
        <View style={styles.card}>
          <View style={styles.fairnessHeaderRow}>
            <Text style={styles.fairnessTitle}>YOUR SHARE PATTERN</Text>
            <Text style={styles.fairnessPrivate}>only visible to you</Text>
          </View>
          <View style={styles.fairnessCompareRow}>
            <View style={styles.fairnessCol}>
              <Text style={styles.fairnessAmount}>{sym}{report.totalSpent.toFixed(2)}</Text>
              <Text style={styles.fairnessColLabel}>You</Text>
            </View>
            <View style={styles.fairnessDivider} />
            <View style={styles.fairnessCol}>
              <Text style={styles.fairnessAmount}>
                {sym}{Math.max(0, report.totalSpent - report.fairnessDelta * report.totalBills).toFixed(2)}
              </Text>
              <Text style={styles.fairnessColLabel}>Equal share</Text>
            </View>
          </View>
          <Text style={styles.fairnessSummary}>
            {report.fairnessLabel === 'even' &&
              'Your share aligns with equal splitting on average.'}
            {report.fairnessLabel === 'overpaying' &&
              `Your share ran ${sym}${Math.abs(report.fairnessDelta).toFixed(2)} above equal on average.`}
            {report.fairnessLabel === 'underpaying' &&
              `Your share ran ${sym}${Math.abs(report.fairnessDelta).toFixed(2)} below equal on average.`}
          </Text>
          <Text style={styles.fairnessBasis}>Based on {report.totalBills} bills this month</Text>
        </View>
      )}

      {/* Settlement behaviour */}
      <View style={styles.card}>
        <Text style={styles.cardTitle}>Settlement</Text>
        <View style={styles.settlementRow}>
          <View style={styles.settlementStat}>
            <Text style={styles.statValue}>
              {report.avgDaysToSettle !== null ? `${report.avgDaysToSettle}d` : '—'}
            </Text>
            <Text style={styles.statLabel}>avg to settle</Text>
          </View>
          <View style={styles.settlementStat}>
            <Text style={styles.statValue}>{report.settlementStreakDays}</Text>
            <Text style={styles.statLabel}>streak (48hr)</Text>
          </View>
        </View>
      </View>

      {/* Spending personality */}
      {report.spendingPersonality && (
        <View style={[styles.card, styles.personalityCard]}>
          <Text style={styles.personalityLabel}>{report.spendingPersonality.label}</Text>
          <Text style={styles.personalityDesc}>{report.spendingPersonality.description}</Text>
          <Text style={styles.personalityMeta}>Based on {report.spendingPersonality.basedOnBills} bills</Text>
          <TouchableOpacity
            style={styles.sharePersonalityBtn}
            onPress={() =>
              Share.share({
                message: `I'm ${report.spendingPersonality!.label} on SplitMate — ${report.spendingPersonality!.description} What's your spending personality?`,
              })
            }
          >
            <Text style={styles.sharePersonalityText}>Share my personality</Text>
          </TouchableOpacity>
        </View>
      )}

      {report.totalBills === 0 && (
        <View style={styles.emptyCard}>
          <Text style={styles.emptyText}>No bills this month yet.</Text>
          <Text style={styles.emptySubtext}>Add a bill to a group to see your report here.</Text>
        </View>
      )}

      {/* Export */}
      {report.totalBills > 0 && (
        <View style={styles.exportRow}>
          <TouchableOpacity style={styles.exportBtn} onPress={() => handleExport('csv')}>
            <Text style={styles.exportText}>Export CSV</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.exportBtn} onPress={() => handleExport('json')}>
            <Text style={styles.exportText}>Export JSON</Text>
          </TouchableOpacity>
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

  heading: { fontSize: 22, fontWeight: '700', color: '#111827' },
  subheading: { fontSize: 14, color: '#6b7280', marginBottom: 20, marginTop: 2 },

  card: {
    backgroundColor: '#fff', borderRadius: 14, padding: 16,
    marginBottom: 14, shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6,
  },
  cardTitle: { fontSize: 13, fontWeight: '600', color: '#6b7280', marginBottom: 12, textTransform: 'uppercase', letterSpacing: 0.5 },

  totalRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  totalLabel: { fontSize: 13, color: '#6b7280', marginBottom: 4 },
  totalAmount: { fontSize: 32, fontWeight: '700', color: '#111827' },
  totalRight: { alignItems: 'flex-end', gap: 4 },
  metaLabel: { fontSize: 13, color: '#9ca3af' },

  catRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  catLeft: {},
  catName: { fontSize: 15, fontWeight: '500', color: '#111827' },
  catCount: { fontSize: 12, color: '#9ca3af', marginTop: 1 },
  catRight: { alignItems: 'flex-end', flex: 1, marginLeft: 16 },
  catAmount: { fontSize: 15, fontWeight: '600', color: '#111827', marginBottom: 4 },
  catBarBg: { height: 4, width: '100%', backgroundColor: '#f3f4f6', borderRadius: 2 },
  catBar: { height: 4, backgroundColor: '#16a34a', borderRadius: 2 },

  fairnessHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  fairnessTitle: { fontSize: 11, fontWeight: '600', color: '#9ca3af', letterSpacing: 0.8 },
  fairnessPrivate: { fontSize: 11, color: '#9ca3af', fontStyle: 'italic' },
  fairnessProgressBg: { height: 6, backgroundColor: '#f3f4f6', borderRadius: 3, marginBottom: 10 },
  fairnessProgressFill: { height: 6, backgroundColor: '#16a34a', borderRadius: 3 },
  fairnessLockedText: { fontSize: 14, color: '#6b7280', lineHeight: 20 },
  fairnessCompareRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  fairnessCol: { flex: 1, alignItems: 'center' },
  fairnessAmount: { fontSize: 22, fontWeight: '700', color: '#111827' },
  fairnessColLabel: { fontSize: 12, color: '#9ca3af', marginTop: 4 },
  fairnessDivider: { width: 1, height: 36, backgroundColor: '#e5e7eb' },
  fairnessSummary: { fontSize: 14, color: '#374151', lineHeight: 21 },
  fairnessBasis: { fontSize: 12, color: '#9ca3af', marginTop: 6 },

  settlementRow: { flexDirection: 'row', gap: 24 },
  settlementStat: { alignItems: 'center' },
  statValue: { fontSize: 28, fontWeight: '700', color: '#111827' },
  statLabel: { fontSize: 12, color: '#9ca3af', marginTop: 2 },

  personalityCard: { backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0' },
  personalityLabel: { fontSize: 18, fontWeight: '700', color: '#15803d', marginBottom: 6 },
  personalityDesc: { fontSize: 14, color: '#374151', lineHeight: 20 },
  personalityMeta: { fontSize: 12, color: '#9ca3af', marginTop: 8 },
  sharePersonalityBtn: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#16a34a',
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: 'center',
  },
  sharePersonalityText: { fontSize: 13, fontWeight: '600', color: '#16a34a' },

  emptyCard: { alignItems: 'center', paddingVertical: 32 },
  emptyText: { fontSize: 16, fontWeight: '600', color: '#374151' },
  emptySubtext: { fontSize: 13, color: '#9ca3af', marginTop: 6, textAlign: 'center' },

  exportRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  exportBtn: {
    flex: 1, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10,
    paddingVertical: 12, alignItems: 'center', backgroundColor: '#fff',
  },
  exportText: { fontSize: 14, fontWeight: '500', color: '#374151' },
});
