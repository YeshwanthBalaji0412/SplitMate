import { router } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useAuth } from '@/hooks/useAuth';
import { signOut } from '@/lib/auth';

export default function Dashboard() {
  const { user } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  async function handleSignOut() {
    setSigningOut(true);
    const result = await signOut();
    setSigningOut(false);

    if (!result.ok) {
      Alert.alert('Sign out failed', result.error);
      return;
    }
    router.replace('/(auth)/login');
  }

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Text style={styles.title}>SplitMate Dashboard</Text>
        <Text style={styles.subtitle}>Signed in as</Text>
        <Text style={styles.email}>{user?.email ?? 'unknown'}</Text>

        <Pressable
          style={({ pressed }) => [
            styles.signOutBtn,
            (signingOut || pressed) && styles.signOutBtnPressed,
          ]}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f9fafb',
    justifyContent: 'center',
    padding: 20,
  },
  content: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 28,
    alignItems: 'center',
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 2,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111111',
    marginBottom: 12,
  },
  subtitle: {
    fontSize: 13,
    color: '#6b7280',
  },
  email: {
    fontSize: 16,
    color: '#111111',
    fontWeight: '500',
    marginBottom: 20,
  },
  signOutBtn: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 24,
    alignItems: 'center',
    backgroundColor: '#ffffff',
  },
  signOutBtnPressed: {
    backgroundColor: '#f3f4f6',
  },
  signOutText: {
    color: '#111111',
    fontSize: 15,
    fontWeight: '500',
  },
});
