import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { DatabaseProvider } from '../src/context/DatabaseContext';
import { notificationService } from '../src/services/NotificationService';

export default function RootLayout() {
  useEffect(() => {
    // Configure how local notifications are presented while the app is
    // in the foreground. Safe no-op on web.
    notificationService.setNotificationHandler();
  }, []);

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
          name="circles/[id]/index"
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
