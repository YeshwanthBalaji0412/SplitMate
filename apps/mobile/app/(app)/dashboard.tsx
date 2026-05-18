import { useEffect, useState, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { router } from 'expo-router';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/providers/SessionProvider';

interface GroupRow {
  id: string;
  name: string;
  type: string;
  currency: string;
  country: string;
  invite_code: string;
}

export default function DashboardScreen() {
  const { session } = useSession();
  const [groups, setGroups] = useState<GroupRow[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  const fetchGroups = useCallback(async () => {
    if (!session) return;
    const { data } = await supabase
      .from('groups')
      .select('id, name, type, currency, country, invite_code')
      .order('created_at', { ascending: false });
    if (data) setGroups(data);
  }, [session]);

  useEffect(() => {
    fetchGroups();
  }, [fetchGroups]);

  const onRefresh = async () => {
    setRefreshing(true);
    await fetchGroups();
    setRefreshing(false);
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.replace('/(auth)/login');
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.actions}>
          <TouchableOpacity style={styles.actionBtn} onPress={() => router.push('/(app)/groups/create')}>
            <Text style={styles.actionText}>+ New Group</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, styles.joinBtn]} onPress={() => router.push('/(app)/groups/join')}>
            <Text style={[styles.actionText, styles.joinText]}>Join</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, styles.reportBtn]} onPress={() => router.push('/(app)/report')}>
            <Text style={[styles.actionText, styles.reportText]}>My Report</Text>
          </TouchableOpacity>
        </View>
      </View>

      {groups.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyTitle}>No groups yet</Text>
          <Text style={styles.emptySubtitle}>Create a group or join one with an invite code</Text>
        </View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(item) => item.id}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#16a34a" />}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.groupCard}
              onPress={() => router.push(`/(app)/groups/${item.id}`)}
            >
              <View style={styles.groupInfo}>
                <Text style={styles.groupName}>{item.name}</Text>
                <Text style={styles.groupMeta}>
                  {item.type} · {item.currency} · {item.country}
                </Text>
              </View>
              <Text style={styles.arrow}>›</Text>
            </TouchableOpacity>
          )}
        />
      )}

      <TouchableOpacity style={styles.signOut} onPress={handleSignOut}>
        <Text style={styles.signOutText}>Sign out</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb' },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 12 },
  actions: { flexDirection: 'row', gap: 10 },
  actionBtn: { backgroundColor: '#16a34a', borderRadius: 10, paddingHorizontal: 16, paddingVertical: 10 },
  actionText: { color: '#fff', fontWeight: '600', fontSize: 14 },
  joinBtn: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#16a34a' },
  joinText: { color: '#16a34a' },
  reportBtn: { backgroundColor: '#fff', borderWidth: 1, borderColor: '#6b7280' },
  reportText: { color: '#374151' },
  empty: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 },
  emptyTitle: { fontSize: 18, fontWeight: '600', color: '#374151' },
  emptySubtitle: { fontSize: 14, color: '#9ca3af', marginTop: 6, textAlign: 'center' },
  list: { padding: 16 },
  groupCard: { backgroundColor: '#fff', borderRadius: 12, padding: 16, marginBottom: 10, flexDirection: 'row', alignItems: 'center', shadowColor: '#000', shadowOpacity: 0.04, shadowRadius: 6 },
  groupInfo: { flex: 1 },
  groupName: { fontSize: 16, fontWeight: '600', color: '#111827' },
  groupMeta: { fontSize: 13, color: '#6b7280', marginTop: 3 },
  arrow: { fontSize: 22, color: '#d1d5db', fontWeight: '300' },
  signOut: { padding: 16, alignItems: 'center' },
  signOutText: { color: '#dc2626', fontSize: 14, fontWeight: '500' },
});
