import { router, useFocusEffect } from 'expo-router';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import type { Group } from '@splitmate/types';
import { useAuth } from '@/hooks/useAuth';
import { useGroups } from '@/hooks/useGroups';
import { signOut } from '@/lib/auth';

export default function Dashboard() {
  const { user } = useAuth();
  const { groups, loading, error, refresh } = useGroups();
  const [signingOut, setSigningOut] = useState(false);

  // Re-fetch when the screen regains focus (e.g. after creating/joining a group).
  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );

  async function handleSignOut() {
    setSigningOut(true);
    const result = await signOut();
    setSigningOut(false);
    if (!result.ok) {
      if (Platform.OS === 'web') window.alert(`Sign out failed: ${result.error}`);
      else Alert.alert('Sign out failed', result.error);
      return;
    }
    router.replace('/(auth)/login');
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Your groups</Text>
          <Text style={styles.subtitle}>{user?.email ?? ''}</Text>
        </View>
        <Pressable
          style={({ pressed }) => [styles.signOutBtn, pressed && styles.signOutBtnPressed]}
          onPress={handleSignOut}
          disabled={signingOut}
        >
          {signingOut ? (
            <ActivityIndicator color="#111111" />
          ) : (
            <Text style={styles.signOutText}>Sign out</Text>
          )}
        </Pressable>
      </View>

      {/* Action buttons -- always visible */}
      <View style={styles.actionRow}>
        <Pressable
          style={({ pressed }) => [styles.primaryBtn, pressed && styles.primaryBtnPressed]}
          onPress={() => router.push('/(app)/groups/create')}
        >
          <Text style={styles.primaryBtnText}>+ Create</Text>
        </Pressable>
        <Pressable
          style={({ pressed }) => [styles.secondaryBtn, pressed && styles.secondaryBtnPressed]}
          onPress={() => router.push('/(app)/groups/join')}
        >
          <Text style={styles.secondaryBtnText}>Join with code</Text>
        </Pressable>
      </View>

      {/* My Report link */}
      <Pressable
        style={({ pressed }) => [styles.reportBtn, pressed && styles.reportBtnPressed]}
        onPress={() => router.push('/(app)/report')}
      >
        <Text style={styles.reportBtnText}>📊 My Report</Text>
      </Pressable>

      {/* List */}
      {loading && groups.length === 0 ? (
        <View style={styles.centered}>
          <ActivityIndicator />
        </View>
      ) : error ? (
        <View style={styles.centered}>
          <Text style={styles.errorText}>{error}</Text>
        </View>
      ) : groups.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyTitle}>No groups yet</Text>
          <Text style={styles.emptySubtitle}>
            Create one above, or paste a friend's invite code to join.
          </Text>
        </View>
      ) : (
        <FlatList
          data={groups}
          keyExtractor={(g) => g.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => <GroupRow group={item} />}
          ItemSeparatorComponent={() => <View style={styles.separator} />}
          onRefresh={refresh}
          refreshing={loading}
        />
      )}
    </View>
  );
}

function GroupRow({ group }: { group: Group }) {
  return (
    <Pressable
      style={({ pressed }) => [styles.groupRow, pressed && styles.groupRowPressed]}
      onPress={() => router.push({ pathname: '/(app)/groups/[id]', params: { id: group.id } })}
    >
      <View style={styles.groupRowLeft}>
        <Text style={styles.groupName}>{group.name}</Text>
        <Text style={styles.groupMeta}>
          {group.country} · {group.currency} · {group.type}
        </Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb', paddingHorizontal: 16, paddingTop: 24 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 16,
    gap: 12,
  },
  title: { fontSize: 24, fontWeight: '700', color: '#111111' },
  subtitle: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  signOutBtn: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    backgroundColor: '#ffffff',
  },
  signOutBtnPressed: { backgroundColor: '#f3f4f6' },
  signOutText: { color: '#111111', fontSize: 13, fontWeight: '500' },

  actionRow: { flexDirection: 'row', gap: 10, marginBottom: 16 },
  primaryBtn: {
    flex: 1,
    backgroundColor: '#16a34a',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
  },
  primaryBtnPressed: { opacity: 0.85 },
  primaryBtnText: { color: '#ffffff', fontSize: 15, fontWeight: '600' },
  secondaryBtn: {
    flex: 1,
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  secondaryBtnPressed: { backgroundColor: '#f3f4f6' },
  secondaryBtnText: { color: '#111111', fontSize: 15, fontWeight: '600' },

  centered: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  emptyTitle: { fontSize: 16, fontWeight: '600', color: '#111111' },
  emptySubtitle: { fontSize: 14, color: '#6b7280', textAlign: 'center' },
  errorText: { color: '#dc2626', textAlign: 'center' },

  listContent: { paddingBottom: 24 },
  groupRow: {
    backgroundColor: '#ffffff',
    borderRadius: 12,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.04,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 8,
    elevation: 1,
  },
  groupRowPressed: { opacity: 0.85 },
  groupRowLeft: { flex: 1 },
  groupName: { fontSize: 16, fontWeight: '600', color: '#111111' },
  groupMeta: { fontSize: 13, color: '#6b7280', marginTop: 2, textTransform: 'capitalize' },
  chevron: { fontSize: 24, color: '#9ca3af' },
  separator: { height: 10 },

  reportBtn: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    backgroundColor: '#ffffff',
    marginBottom: 12,
  },
  reportBtnPressed: { backgroundColor: '#f3f4f6' },
  reportBtnText: { color: '#111111', fontSize: 14, fontWeight: '500' },
});
