/**
 * Root layout and composition root (docs/ARCHITECTURE.md §9).
 *
 * This is the only place in the codebase that names concrete adapters. It is
 * intentionally thin: as the persistence layer (#17-#19) and use cases land,
 * the container is built here and passed down — never constructed inside a
 * screen.
 *
 * Phase A: basic controls only. No styling work belongs here (docs/PRODUCT.md §6).
 */
import React from 'react';
import { Stack } from 'expo-router';
import { SafeAreaProvider } from 'react-native-safe-area-context';

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <Stack screenOptions={{ headerShown: true }} />
    </SafeAreaProvider>
  );
}
