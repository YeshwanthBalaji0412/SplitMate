import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';
import type { CountryCode, GroupType, SettlementMode } from '@split-smart/types';

const GROUP_TYPES: { value: GroupType; label: string }[] = [
  { value: 'roommates', label: 'Roommates' },
  { value: 'trip', label: 'Trip' },
  { value: 'household', label: 'Household' },
  { value: 'event', label: 'Event' },
  { value: 'other', label: 'Other' },
];

const COUNTRIES: { value: CountryCode; label: string; currency: string }[] = [
  { value: 'IN', label: 'India', currency: 'INR' },
  { value: 'US', label: 'USA', currency: 'USD' },
];

export default function CreateGroupScreen() {
  const [name, setName] = useState('');
  const [groupType, setGroupType] = useState<GroupType>('roommates');
  const [country, setCountry] = useState<CountryCode>('IN');
  const [settlementMode, setSettlementMode] = useState<SettlementMode>('optimized');
  const [loading, setLoading] = useState(false);

  const selectedCountry = COUNTRIES.find((c) => c.value === country)!;

  async function handleCreate() {
    if (!name.trim()) {
      Alert.alert('Error', 'Group name is required');
      return;
    }

    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    const { data, error } = await supabase
      .from('groups')
      .insert({
        name: name.trim(),
        type: groupType,
        currency: selectedCountry.currency,
        country,
        settlement_mode: settlementMode,
        created_by: user.id,
      })
      .select('id')
      .single();

    if (error) {
      Alert.alert('Error', error.message);
      setLoading(false);
      return;
    }

    // Auto-add creator as admin
    await supabase.from('group_members').insert({
      group_id: data.id,
      user_id: user.id,
      role: 'admin',
    });

    setLoading(false);
    router.replace(`/(app)/groups/${data.id}`);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.label}>Group name</Text>
      <TextInput
        style={styles.input}
        placeholder="e.g. Flat 302, Goa Trip 2026"
        value={name}
        onChangeText={setName}
      />

      <Text style={styles.label}>Type</Text>
      <View style={styles.chips}>
        {GROUP_TYPES.map((t) => (
          <TouchableOpacity
            key={t.value}
            style={[styles.chip, groupType === t.value && styles.chipActive]}
            onPress={() => setGroupType(t.value)}
          >
            <Text style={[styles.chipText, groupType === t.value && styles.chipTextActive]}>
              {t.label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Country</Text>
      <View style={styles.chips}>
        {COUNTRIES.map((c) => (
          <TouchableOpacity
            key={c.value}
            style={[styles.chip, country === c.value && styles.chipActive]}
            onPress={() => setCountry(c.value)}
          >
            <Text style={[styles.chipText, country === c.value && styles.chipTextActive]}>
              {c.label} ({c.currency})
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Settlement mode</Text>
      <View style={styles.chips}>
        <TouchableOpacity
          style={[styles.chip, settlementMode === 'optimized' && styles.chipActive]}
          onPress={() => setSettlementMode('optimized')}
        >
          <Text style={[styles.chipText, settlementMode === 'optimized' && styles.chipTextActive]}>
            Optimized (fewer transfers)
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.chip, settlementMode === 'direct' && styles.chipActive]}
          onPress={() => setSettlementMode('direct')}
        >
          <Text style={[styles.chipText, settlementMode === 'direct' && styles.chipTextActive]}>
            Direct (pay who you owe)
          </Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.button} onPress={handleCreate} disabled={loading}>
        <Text style={styles.buttonText}>{loading ? 'Creating...' : 'Create Group'}</Text>
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  content: { padding: 20 },
  label: { fontSize: 14, fontWeight: '600', color: '#374151', marginBottom: 8, marginTop: 16 },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, backgroundColor: '#fff', color: '#111827' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 20, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: '#fff' },
  chipActive: { backgroundColor: '#16a34a', borderColor: '#16a34a' },
  chipText: { fontSize: 13, color: '#6b7280' },
  chipTextActive: { color: '#fff', fontWeight: '600' },
  button: { backgroundColor: '#16a34a', borderRadius: 10, paddingVertical: 14, alignItems: 'center', marginTop: 28 },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
