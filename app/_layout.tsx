/**
 * Root layout.
 *
 * Handles the three boot states. The failure state matters most: a database
 * that will not open may still hold years of relationship history, so the app
 * offers retry and explains itself rather than recreating anything
 * (docs/ARCHITECTURE.md §6).
 */
import React from 'react';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppProvider, useApp } from '../src/ui/AppContext';
import { Body, Button, Heading, Loading, Screen, Spacer } from '../src/ui/basics';

function BootGate({ children }: { children: React.ReactNode }) {
  const { boot, retry } = useApp();

  if (boot.phase === 'loading') return <Loading label="Opening your data" />;

  if (boot.phase === 'failed') {
    return (
      <Screen>
        <Heading>Could not open your data</Heading>
        <Body>
          Stay Close keeps everything on this device and could not read its database. Nothing has
          been deleted.
        </Body>
        <Spacer />
        <Body dim>{boot.status.detail}</Body>
        <Spacer />
        <Button label="Try again" variant="primary" onPress={retry} />
      </Screen>
    );
  }

  return <>{children}</>;
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppProvider>
        <BootGate>
          <Stack screenOptions={{ headerShown: true, headerTitleStyle: { fontSize: 17 } }}>
            <Stack.Screen name="index" options={{ title: 'Stay Close' }} />
            <Stack.Screen name="groups/index" options={{ title: 'Groups' }} />
            <Stack.Screen name="groups/create" options={{ title: 'New group' }} />
            <Stack.Screen name="groups/[id]/index" options={{ title: 'Group' }} />
            <Stack.Screen name="groups/[id]/add" options={{ title: 'Add people' }} />
          </Stack>
        </BootGate>
      </AppProvider>
    </SafeAreaProvider>
  );
}
