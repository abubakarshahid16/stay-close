export type NotificationPrivacy = 'private' | 'detailed';

export interface AppSettings {
  notificationPrivacy: NotificationPrivacy;
  onboardingCompleted: boolean;
  contactsPermissionExplained: boolean;
  notificationsPermissionExplained: boolean;
}

export const DEFAULT_SETTINGS: AppSettings = {
  notificationPrivacy: 'private',
  onboardingCompleted: false,
  contactsPermissionExplained: false,
  notificationsPermissionExplained: false,
};

export type SettingKey = keyof AppSettings;
