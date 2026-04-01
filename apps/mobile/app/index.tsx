import { Redirect } from 'expo-router';

/**
 * Root index — immediately redirects based on auth state.
 * Auth state management will be wired in Milestone 2 via a SessionProvider.
 */
export default function Index() {
  // TODO (Milestone 2): check session and redirect accordingly
  return <Redirect href="/(auth)/login" />;
}
