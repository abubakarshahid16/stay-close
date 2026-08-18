import React, { useEffect } from 'react';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DatabaseProvider, useDatabase } from '../src/context/DatabaseContext';
import { notificationService } from '../src/services/NotificationService';
import { ErrorView } from '../src/components/ErrorView';
import { LoadingView } from '../src/components/LoadingView';

function AppContent() {
  const { isReady, error } = useDatabase();

  // Register notification handler for foreground notifications (iOS)
  useEffect(() => {
    notificationService.setNotificationHandler();
  }, []);

  if (!isReady) return <LoadingView />;

  if (error) {
    return (
      <ErrorView
        message="Database failed to open. Try reinstalling the app."
      />
    );
  }

  return (
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
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <DatabaseProvider>
        <AppContent />
      </DatabaseProvider>
    </SafeAreaProvider>
  );
}
