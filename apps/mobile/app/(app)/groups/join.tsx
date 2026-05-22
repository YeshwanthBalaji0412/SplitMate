import { router, Stack } from 'expo-router';
import { useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { formatInviteCodeForDisplay } from '@/lib/inviteCode';
import { joinGroupByInviteCode } from '@/hooks/useInviteJoin';

export default function JoinGroupScreen() {
  const [code, setCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit() {
    setError(null);
    if (!code.trim()) {
      setError('Paste an invite code to join.');
      return;
    }

    setSubmitting(true);
    const result = await joinGroupByInviteCode(code);
    setSubmitting(false);

    if (!result.ok) {
      setError(result.error);
      return;
    }
    router.replace({ pathname: '/(app)/groups/[id]', params: { id: result.groupId } });
  }

  return (
    <>
      <Stack.Screen options={{ headerShown: true, title: 'Join a group' }} />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.card}>
          <Text style={styles.title}>Join with an invite code</Text>
          <Text style={styles.subtitle}>
            Someone in the group can share a 12-character code with you.
          </Text>

          <TextInput
            style={styles.input}
            placeholder="abcd-1234-ef56"
            placeholderTextColor="#9ca3af"
            value={code}
            onChangeText={(v) => setCode(v)}
            editable={!submitting}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus
          />

          {code ? (
            <Text style={styles.preview}>
              You typed: <Text style={styles.previewMono}>{formatInviteCodeForDisplay(code)}</Text>
            </Text>
          ) : null}

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
              <Text style={styles.primaryBtnText}>Join group</Text>
            )}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f9fafb', justifyContent: 'center', padding: 20 },
  card: {
    backgroundColor: '#ffffff',
    borderRadius: 16,
    padding: 24,
    gap: 12,
    shadowColor: '#000',
    shadowOpacity: 0.05,
    shadowOffset: { width: 0, height: 4 },
    shadowRadius: 12,
    elevation: 2,
  },
  title: { fontSize: 22, fontWeight: '700', color: '#111111' },
  subtitle: { fontSize: 14, color: '#6b7280', marginBottom: 8 },
  input: {
    borderWidth: 1,
    borderColor: '#d1d5db',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: '#111111',
    backgroundColor: '#ffffff',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  preview: { fontSize: 13, color: '#6b7280' },
  previewMono: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', color: '#111111' },
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
