import { Stack } from 'expo-router';

export default function AppLayout() {
  return (
    <Stack>
      <Stack.Screen name="dashboard" options={{ title: 'My Groups', headerShadowVisible: false }} />
      <Stack.Screen name="groups/create" options={{ title: 'New Group', presentation: 'modal' }} />
      <Stack.Screen name="groups/join" options={{ title: 'Join Group', presentation: 'modal' }} />
      <Stack.Screen name="groups/[id]/index" options={{ title: 'Group' }} />
      <Stack.Screen name="groups/[id]/bill-entry" options={{ title: 'New Bill', presentation: 'modal' }} />
      <Stack.Screen name="groups/[id]/assign-items" options={{ title: 'Assign Items' }} />
      <Stack.Screen name="groups/[id]/bill/[billId]" options={{ title: 'Bill Details' }} />
      <Stack.Screen name="groups/[id]/settle" options={{ title: 'Settle Up' }} />
    </Stack>
  );
}
