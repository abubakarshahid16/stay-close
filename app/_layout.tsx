import React from 'react';
import { Stack } from 'expo-router';
import { DatabaseProvider } from '../src/context/DatabaseContext';

export default function RootLayout() {
  return (
    <DatabaseProvider>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="onboarding" options={{ animation: 'fade' }} />
        <Stack.Screen
          name="circles/create"
          options={{ presentation: 'modal', headerShown: true, title: 'New Circle' }}
        />
        <Stack.Screen
          name="circles/[id]"
          options={{ headerShown: true, title: 'Circle' }}
        />
        <Stack.Screen
          name="circles/[id]/select"
          options={{ headerShown: true, title: 'Add People' }}
        />
        <Stack.Screen
          name="settings/index"
          options={{ headerShown: true, title: 'Settings' }}
        />
      </Stack>
    </DatabaseProvider>
  );
}
