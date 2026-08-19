import React, { useEffect, useState } from 'react';
import { Alert, Platform, Text, TouchableOpacity, View } from 'react-native';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DatabaseProvider, useDatabase } from '../src/context/DatabaseContext';
import { notificationService } from '../src/services/NotificationService';
import { resetLocalData } from '../src/db/database';
import { ErrorView } from '../src/components/ErrorView';
import { LoadingView } from '../src/components/LoadingView';

function AppContent() {
  const { isReady, error, retry } = useDatabase();

  useEffect(() => {
    notificationService.setNotificationHandler();
  }, []);

  if (!isReady) return <LoadingView />;

  if (error) {
    return <DatabaseErrorScreen onRetry={retry} />;
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

function DatabaseErrorScreen({ onRetry }: { onRetry: () => void }) {
  const [isResetting, setIsResetting] = useState(false);
  const IS_WEB = Platform.OS === 'web';

  const doReset = async () => {
    setIsResetting(true);
    try {
      await resetLocalData();
    } catch {
      setIsResetting(false);
    }
  };

  const handleReset = () => {
    if (IS_WEB) {
      if (window.confirm('This erases everything Stay Close has stored on this device — all circles and people. This cannot be undone. Continue?')) {
        doReset();
      }
      return;
    }
    Alert.alert(
      'Erase all local data?',
      'This erases everything Stay Close has stored on this device — all circles and people. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Erase everything', style: 'destructive', onPress: doReset },
      ]
    );
  };

  return (
    <View style={{ flex: 1 }}>
      <ErrorView
        message="Stay Close couldn't open your data. This is almost always because the app is open in another tab or window at the same time — close it there and tap Try Again."
        onRetry={onRetry}
      />
      <View style={{ position: 'absolute', bottom: 40, left: 0, right: 0, alignItems: 'center' }}>
        <Text style={{ color: '#999', fontSize: 13, marginBottom: 8, textAlign: 'center', paddingHorizontal: 32 }}>
          Still stuck after closing other tabs?
        </Text>
        <TouchableOpacity onPress={handleReset} disabled={isResetting} accessibilityRole="button" testID="reset-local-data-button">
          <Text style={{ color: '#FF3B30', fontSize: 14, fontWeight: '600' }}>
            {isResetting ? 'Erasing…' : 'Erase all local data and start fresh'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
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
