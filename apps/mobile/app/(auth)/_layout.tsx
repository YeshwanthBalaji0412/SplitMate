import { Stack } from 'expo-router';

export default function AuthLayout() {
  return (
    <Stack>
      <Stack.Screen name="login" options={{ title: 'Sign in', headerShown: false }} />
      <Stack.Screen name="signup" options={{ title: 'Create account', headerShown: false }} />
    </Stack>
  );
}
