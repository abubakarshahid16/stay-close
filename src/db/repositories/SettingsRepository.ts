import type { SQLiteDatabase } from 'expo-sqlite';
import type { AppSettings, NotificationPrivacy } from '../../types/settings';
import { DEFAULT_SETTINGS } from '../../types/settings';

export class SettingsRepository {
  constructor(private db: SQLiteDatabase) {}

  async get(key: string): Promise<string | null> {
    const row = await this.db.getFirstAsync<{ value: string }>(
      'SELECT value FROM settings WHERE key = ?',
      [key]
    );
    return row?.value ?? null;
  }

  async set(key: string, value: string): Promise<void> {
    await this.db.runAsync(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [key, value]
    );
  }

  async delete(key: string): Promise<void> {
    await this.db.runAsync('DELETE FROM settings WHERE key = ?', [key]);
  }

  async getAll(): Promise<Record<string, string>> {
    const rows = await this.db.getAllAsync<{ key: string; value: string }>(
      'SELECT key, value FROM settings'
    );
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  async deleteAll(): Promise<void> {
    await this.db.runAsync('DELETE FROM settings');
  }

  // Typed helpers for AppSettings

  async getAppSettings(): Promise<AppSettings> {
    const all = await this.getAll();
    return {
      notificationPrivacy: (all['notification_privacy'] as NotificationPrivacy) ??
        DEFAULT_SETTINGS.notificationPrivacy,
      onboardingCompleted: all['onboarding_completed'] === 'true',
      contactsPermissionExplained: all['contacts_permission_explained'] === 'true',
      notificationsPermissionExplained: all['notifications_permission_explained'] === 'true',
    };
  }

  async setNotificationPrivacy(value: NotificationPrivacy): Promise<void> {
    await this.set('notification_privacy', value);
  }

  async setOnboardingCompleted(value: boolean): Promise<void> {
    await this.set('onboarding_completed', value.toString());
  }

  async setContactsPermissionExplained(value: boolean): Promise<void> {
    await this.set('contacts_permission_explained', value.toString());
  }

  async setNotificationsPermissionExplained(value: boolean): Promise<void> {
    await this.set('notifications_permission_explained', value.toString());
  }
}
