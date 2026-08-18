/**
 * useSettings — reads and writes AppSettings reactively.
 */
import { useState, useEffect, useCallback } from 'react';
import type { AppSettings } from '../types/settings';
import { DEFAULT_SETTINGS } from '../types/settings';
import { SettingsRepository } from '../db/repositories/SettingsRepository';
import { useDatabase } from '../context/DatabaseContext';

interface UseSettingsResult {
  settings: AppSettings;
  isLoading: boolean;
  setNotificationPrivacy: (value: AppSettings['notificationPrivacy']) => Promise<void>;
  setOnboardingCompleted: (value: boolean) => Promise<void>;
  setContactsPermissionExplained: (value: boolean) => Promise<void>;
  refresh: () => Promise<void>;
}

export function useSettings(): UseSettingsResult {
  const { db, isReady } = useDatabase();
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!db) return;
    try {
      const repo = new SettingsRepository(db);
      const appSettings = await repo.getAppSettings();
      setSettings(appSettings);
    } finally {
      setIsLoading(false);
    }
  }, [db]);

  useEffect(() => {
    if (isReady) {
      refresh();
    }
  }, [isReady, refresh]);

  const setNotificationPrivacy = useCallback(
    async (value: AppSettings['notificationPrivacy']) => {
      if (!db) return;
      const repo = new SettingsRepository(db);
      await repo.setNotificationPrivacy(value);
      setSettings((prev) => ({ ...prev, notificationPrivacy: value }));
    },
    [db]
  );

  const setOnboardingCompleted = useCallback(
    async (value: boolean) => {
      if (!db) return;
      const repo = new SettingsRepository(db);
      await repo.setOnboardingCompleted(value);
      setSettings((prev) => ({ ...prev, onboardingCompleted: value }));
    },
    [db]
  );

  const setContactsPermissionExplained = useCallback(
    async (value: boolean) => {
      if (!db) return;
      const repo = new SettingsRepository(db);
      await repo.set('contactsPermissionExplained', value ? 'true' : 'false');
      setSettings((prev) => ({ ...prev, contactsPermissionExplained: value }));
    },
    [db]
  );

  return {
    settings,
    isLoading,
    setNotificationPrivacy,
    setOnboardingCompleted,
    setContactsPermissionExplained,
    refresh,
  };
}
