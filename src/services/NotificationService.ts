import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { Circle } from '../types/circle';
import { REMINDER_FREQUENCY_DAYS } from '../types/circle';
import type { NotificationPrivacy } from '../types/settings';

function circleNotificationId(circleId: number): string {
  return \`circle-reminder-\${circleId}\`;
}

export class NotificationService {
  isAvailable(): boolean {
    return Platform.OS !== 'web';
  }

  isWebSupported(): boolean {
    return Platform.OS === 'web' && typeof Notification !== 'undefined';
  }

  async getPermissionStatus(): Promise<{ granted: boolean; status: string }> {
    if (Platform.OS === 'web') {
      if (!this.isWebSupported()) return { granted: false, status: 'unavailable' };
      return { granted: Notification.permission === 'granted', status: Notification.permission };
    }
    const result = await Notifications.getPermissionsAsync();
    return {
      granted: result.granted,
      status: result.status,
    };
  }

  async requestPermission(): Promise<{ granted: boolean }> {
    if (Platform.OS === 'web') {
      if (!this.isWebSupported()) return { granted: false };
      const permission = await Notification.requestPermission();
      return { granted: permission === 'granted' };
    }
    const result = await Notifications.requestPermissionsAsync();
    return { granted: result.granted };
  }

  showWebNotificationNow(
    privacy: NotificationPrivacy = 'private',
    personName?: string
  ): void {
    if (!this.isWebSupported() || Notification.permission !== 'granted') return;
    const body =
      privacy === 'detailed' && personName
        ? \`Maybe reach out to \${personName} today.\`
        : 'You have someone to reconnect with.';
    try {
      new Notification('Stay Close', { body, tag: 'stay-close-suggestion' });
    } catch {
    }
  }

  async scheduleForCircle(
    circle: Circle,
    privacy: NotificationPrivacy = 'private',
    personName?: string
  ): Promise<void> {
    if (!this.isAvailable()) return;
    const identifier = circleNotificationId(circle.id);
    await this.cancelForCircle(circle.id);
    const days = REMINDER_FREQUENCY_DAYS[circle.reminderFrequency];
    const intervalSeconds = days * 24 * 60 * 60;
    const body =
      privacy === 'detailed' && personName
        ? \`Maybe reach out to \${personName} today.\`
        : 'You have someone to reconnect with.';
    await Notifications.scheduleNotificationAsync({
      identifier,
      content: {
        title: 'Stay Close',
        body,
        data: { circleId: circle.id },
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
        seconds: intervalSeconds,
        repeats: true,
      } as Parameters<typeof Notifications.scheduleNotificationAsync>[0]['trigger'],
    });
  }

  async cancelForCircle(circleId: number): Promise<void> {
    if (!this.isAvailable()) return;
    try {
      await Notifications.cancelScheduledNotificationAsync(
        circleNotificationId(circleId)
      );
    } catch {
    }
  }

  async cancelAll(): Promise<void> {
    if (!this.isAvailable()) return;
    await Notifications.cancelAllScheduledNotificationsAsync();
  }

  async rescheduleForCircle(
    circle: Circle,
    privacy: NotificationPrivacy = 'private',
    personName?: string
  ): Promise<void> {
    await this.scheduleForCircle(circle, privacy, personName);
  }

  setNotificationHandler(): void {
    if (!this.isAvailable()) return;
    Notifications.setNotificationHandler({
      handleNotification: async () => ({
        shouldShowAlert: true,
        shouldPlaySound: true,
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      }),
    });
  }
}

export const notificationService = new NotificationService();
