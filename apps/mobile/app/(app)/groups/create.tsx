import { router, Stack } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { Country, GroupType, SettlementMode } from '@splitmate/types';
import { createGroup } from '@/hooks/useGroups';

const GROUP_TYPES: Array<{ value: GroupType; label: string }> = [
  { value: 'trip', label: 'Trip' },
  { value: 'roommates', label: 'Roommates' },
  { value: 'household', label: 'Household' },
  { value: 'event', label: 'Event' },
  { value: 'other', label: 'Other' },
];

const COUNTRIES: Array<{ value: Country; label: string; currency: string }> = [
  { value: 'US', label: 'United States', currency: 'USD' },
  { value: 'IN', label: 'India', currency: 'INR' },
];

const SETTLEMENT_MODES: Array<{ value: SettlementMode; label: string; hint: string }> = [
  { value: 'optimized', label: 'Optimized', hint: 'Fewer transfers, traced to bills' },
  { value: 'direct', label: 'Direct', hint: 'Pay exactly who you owe per bill' },
];

export default function CreateGroupScreen() {
  const [name, setName] = useState('');
  const [type, setType] = useState<GroupType>('other');
  const [country, setCountry] = useState<Country>('US');
  const [settlementMode, setSettlementMode] = useState<SettlementMode>('optimized');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const currency = COUNTRIES.find((c) => c.value === country)!.currency;

  async function handleSubmit() {
    setError(null);
    if (!name.trim()) {
      setError('Group name is required.');
      return;
    }

    setSubmitting(true);
    const result = await createGroup({
      name: name.trim(),
      type,
      currency,
      country,
      settlementMode,
    });
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.replace({ pathname: '/(app)/groups/[id]', params: { id: result.group.id } });
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'New group' }} />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
          <View style={styles.card}>
            <Text style={styles.sectionLabel}>Group name</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. Beach Trip 2026"
              placeholderTextColor="#9ca3af"
              value={name}
              onChangeText={setName}
              editable={!submitting}
              autoFocus
            />

            <Text style={styles.sectionLabel}>Group type</Text>
            <View style={styles.chipRow}>
              {GROUP_TYPES.map((t) => (
                <Pressable
                  key={t.value}
                  style={[styles.chip, type === t.value && styles.chipActive]}
                  onPress={() => setType(t.value)}
                  disabled={submitting}
                >
                  <Text style={[styles.chipText, type === t.value && styles.chipTextActive]}>
                    {t.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.sectionLabel}>Country &amp; currency</Text>
            <View style={styles.chipRow}>
              {COUNTRIES.map((c) => (
                <Pressable
                  key={c.value}
                  style={[styles.chip, country === c.value && styles.chipActive]}
                  onPress={() => setCountry(c.value)}
                  disabled={submitting}
                >
                  <Text style={[styles.chipText, country === c.value && styles.chipTextActive]}>
                    {c.label} ({c.currency})
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.sectionLabel}>Settlement mode</Text>
            <View style={styles.modeStack}>
              {SETTLEMENT_MODES.map((m) => (
                <Pressable
                  key={m.value}
                  style={[
                    styles.modeOption,
                    settlementMode === m.value && styles.modeOptionActive,
                  ]}
                  onPress={() => setSettlementMode(m.value)}
                  disabled={submitting}
                >
                  <Text
                    style={[
                      styles.modeTitle,
                      settlementMode === m.value && styles.modeTitleActive,
                    ]}
                  >
                    {m.label}
                  </Text>
                  <Text style={styles.modeHint}>{m.hint}</Text>
                </Pressable>
              ))}
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            <Pressable
              style={({ pressed }) => [
                styles.primaryBtn,
                (submitting || pressed) && styles.primaryBtnPressed,
              ]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#ffffff" />
              ) : (
                <Text style={styles.primaryBtnText}>Create group</Text>
              )}
            </Pressable>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  scroll: { padding: 20 },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 24,
    gap: 16,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 2,
  },
  sectionLabel: { fontSize: 13, fontWeight: '600', color: '#374151', marginBottom: -8 },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111111',
    backgroundColor: '#ffffff',
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
    backgroundColor: '#ffffff',
  },
  chipActive: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  chipText: { fontSize: 14, color: '#374151' },
  chipTextActive: { color: '#ffffff', fontWeight: '600' },
  modeStack: { gap: 10 },
  modeOption: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 12,
    padding: 14,
    backgroundColor: '#ffffff',
  },
  modeOptionActive: { borderColor: '#16a34a', backgroundColor: '#f0fdf4' },
  modeTitle: { fontSize: 15, fontWeight: '600', color: '#111111' },
  modeTitleActive: { color: '#15803d' },
  modeHint: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  error: { color: '#dc2626', fontSize: 14 },
  primaryBtn: {
    backgroundColor: '#16a34a',
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 4,
  },
  primaryBtnPressed: { opacity: 0.85 },
  primaryBtnText: { color: '#ffffff', fontSize: 16, fontWeight: '600' },
});
