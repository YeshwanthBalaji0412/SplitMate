import { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';

export default function JoinGroupScreen() {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleJoin() {
    const trimmed = code.trim().toLowerCase();
    if (!trimmed) {
      Alert.alert('Error', 'Enter an invite code');
      return;
    }

    setLoading(true);
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { setLoading(false); return; }

    // Look up group by invite code
    const { data: group, error: lookupError } = await supabase
      .from('groups')
      .select('id, name')
      .eq('invite_code', trimmed)
      .single();

    if (lookupError || !group) {
      Alert.alert('Not found', 'No group with that invite code');
      setLoading(false);
      return;
    }

    // Check if already a member
    const { data: existing } = await supabase
      .from('group_members')
      .select('id')
      .eq('group_id', group.id)
      .eq('user_id', user.id)
      .single();

    if (existing) {
      Alert.alert('Already joined', `You're already in "${group.name}"`);
      setLoading(false);
      router.replace(`/(app)/groups/${group.id}`);
      return;
    }

    // Join
    const { error: joinError } = await supabase.from('group_members').insert({
      group_id: group.id,
      user_id: user.id,
      role: 'member',
    });

    setLoading(false);
    if (joinError) {
      Alert.alert('Error', joinError.message);
      return;
    }

    router.replace(`/(app)/groups/${group.id}`);
  }

  return (
    <View style={styles.container}>
      <View style={styles.card}>
        <Text style={styles.title}>Join a group</Text>
        <Text style={styles.subtitle}>Enter the invite code shared by your group</Text>

        <TextInput
          style={styles.input}
          placeholder="Invite code (e.g. a3f29c)"
          autoCapitalize="none"
          autoCorrect={false}
          value={code}
          onChangeText={setCode}
        />

        <TouchableOpacity style={styles.button} onPress={handleJoin} disabled={loading}>
          <Text style={styles.buttonText}>{loading ? 'Joining...' : 'Join Group'}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb', justifyContent: 'center', padding: 24 },
  card: { backgroundColor: '#fff', borderRadius: 16, padding: 24, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 12 },
  title: { fontSize: 20, fontWeight: '700', color: '#111827', marginBottom: 4 },
  subtitle: { fontSize: 14, color: '#6b7280', marginBottom: 20 },
  input: { borderWidth: 1, borderColor: '#d1d5db', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, marginBottom: 16, color: '#111827', letterSpacing: 1.5, textAlign: 'center' },
  button: { backgroundColor: '#16a34a', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  buttonText: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
