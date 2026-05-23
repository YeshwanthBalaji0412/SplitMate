import { Stack } from 'expo-router';
import { useCallback, useMemo } from 'react';
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
import { computeMonthlyReport, exportToCSV, exportToJSON } from '@splitmate/analytics';
import type { MonthlyReport } from '@splitmate/analytics';
import { useAuth } from '@/hooks/useAuth';
import { useBillRecords } from '@/hooks/useBillRecords';

export default function ReportScreen() {
  const { user } = useAuth();
  const userId = user?.id;
  const { records, loading } = useBillRecords(userId);

  const report: MonthlyReport | null = useMemo(() => {
    if (!userId || records.length === 0) return null;
    return computeMonthlyReport(records, userId);
  }, [records, userId]);

  const handleExport = useCallback(
    (format: 'json' | 'csv') => {
      if (!userId) return;
      const content = format === 'json' ? exportToJSON(records) : exportToCSV(records, userId);
      if (Platform.OS === 'web') {
        const blob = new Blob([content], { type: format === 'json' ? 'application/json' : 'text/csv' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `splitmate-report.${format}`;
        a.click();
        URL.revokeObjectURL(url);
      } else {
        Alert.alert('Export', `${format.toUpperCase()} export generated (${content.length} chars). Share functionality requires expo-sharing in a future phase.`);
      }
    },
    [records, userId],
  );

  if (loading) {
    return (
      <View style={styles.centered}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'My Report' }} />
      <ScrollView style={styles.container} contentContainerStyle={styles.scroll}>
        {!report ? (
          <View style={styles.emptyCard}>
            <Text style={styles.emptyTitle}>No bills yet</Text>
            <Text style={styles.emptyHint}>Reports will appear once you add and settle bills.</Text>
          </View>
        ) : (
          <>
            {/* Summary */}
            <View style={styles.card}>
              <Text style={styles.cardTitle}>This month</Text>
              <View style={styles.metricRow}>
                <MetricBox label="Total spent" value={`$${report.totalSpent.toFixed(2)}`} />
                <MetricBox label="Bills" value={String(report.billCount)} />
              </View>
              <View style={styles.metricRow}>
                <MetricBox label="Avg days to settle" value={report.avgDaysToSettle != null ? `${report.avgDaysToSettle}d` : '—'} />
                <MetricBox label="Settlement streak" value={`${report.settlementStreak} bill${report.settlementStreak === 1 ? '' : 's'}`} />
              </View>
            </View>

            {/* Category breakdown */}
            {report.categoryBreakdown.length > 0 && (
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Category breakdown</Text>
                {report.categoryBreakdown.map((cat) => (
                  <View key={cat.category} style={styles.catRow}>
                    <Text style={styles.catLabel}>{cat.category}</Text>
                    <View style={styles.barTrack}>
                      <View style={[styles.barFill, { width: `${Math.min(cat.percentage, 100)}%` }]} />
                    </View>
                    <Text style={styles.catAmount}>${cat.amount.toFixed(2)}</Text>
                    <Text style={styles.catPct}>{cat.percentage}%</Text>
                  </View>
                ))}
              </View>
            )}

            {/* Personality */}
            {report.personality && (
              <View style={[styles.card, styles.personalityCard]}>
                <Text style={styles.personalityLabel}>Your spending personality</Text>
                <Text style={styles.personalityType}>{report.personality}</Text>
              </View>
            )}

            {/* Export */}
            <View style={styles.exportRow}>
              <Pressable
                style={({ pressed }) => [styles.exportBtn, pressed && styles.exportBtnPressed]}
                onPress={() => handleExport('csv')}
              >
                <Text style={styles.exportBtnText}>Export CSV</Text>
              </Pressable>
              <Pressable
                style={({ pressed }) => [styles.exportBtn, pressed && styles.exportBtnPressed]}
                onPress={() => handleExport('json')}
              >
                <Text style={styles.exportBtnText}>Export JSON</Text>
              </Pressable>
            </View>
          </>
        )}
      </ScrollView>
    </>
  );
}

function MetricBox({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricBox}>
      <Text style={styles.metricValue}>{value}</Text>
      <Text style={styles.metricLabel}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  scroll: { padding: 16, gap: 12, paddingBottom: 32 },
  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#f9fafb' },

  emptyCard: { backgroundColor: '#fff', borderRadius: 14, padding: 32, alignItems: 'center', gap: 6 },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: '#111' },
  emptyHint: { fontSize: 13, color: '#6b7280', textAlign: 'center' },

  card: {
    backgroundColor: '#fff', borderRadius: 14, padding: 18, gap: 12,
    shadowColor: '#000', shadowOpacity: 0.04, shadowOffset: { width: 0, height: 2 }, shadowRadius: 8, elevation: 1,
  },
  cardTitle: { fontSize: 16, fontWeight: '600', color: '#111' },

  metricRow: { flexDirection: 'row', gap: 10 },
  metricBox: {
    flex: 1, backgroundColor: '#f9fafb', borderRadius: 10, padding: 14, alignItems: 'center', gap: 4,
  },
  metricValue: { fontSize: 20, fontWeight: '700', color: '#111' },
  metricLabel: { fontSize: 12, color: '#6b7280' },

  catRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  catLabel: { width: 80, fontSize: 13, color: '#374151', textTransform: 'capitalize' },
  barTrack: { flex: 1, height: 8, backgroundColor: '#e5e7eb', borderRadius: 4 },
  barFill: { height: 8, backgroundColor: '#16a34a', borderRadius: 4 },
  catAmount: { width: 60, fontSize: 13, color: '#111', textAlign: 'right' },
  catPct: { width: 36, fontSize: 12, color: '#6b7280', textAlign: 'right' },

  personalityCard: { backgroundColor: '#f0fdf4', borderWidth: 1, borderColor: '#bbf7d0' },
  personalityLabel: { fontSize: 13, color: '#166534' },
  personalityType: { fontSize: 24, fontWeight: '700', color: '#15803d' },

  exportRow: { flexDirection: 'row', gap: 10 },
  exportBtn: {
    flex: 1, borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10,
    paddingVertical: 12, alignItems: 'center', backgroundColor: '#fff',
  },
  exportBtnPressed: { backgroundColor: '#f3f4f6' },
  exportBtnText: { color: '#111', fontSize: 14, fontWeight: '500' },
});
