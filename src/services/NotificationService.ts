import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { Circle } from '../types/circle';
import { REMINDER_FREQUENCY_DAYS } from '../types/circle';
import type { NotificationPrivacy } from '../types/settings';

function circleNotificationId(circleId: number): string {
  return `circle-reminder-${circleId}`;
}

export class NotificationService {
  /**
   * Local scheduled notifications are only supported on iOS/Android.
   * On web every method becomes a safe no-op.
   */
  isAvailable(): boolean {
    return Platform.OS !== 'web';
  }

  async getPermissionStatus(): Promise<{ granted: boolean; status: string }> {
    if (!this.isAvailable()) {
      return { granted: false, status: 'unavailable' };
    }
    const result = await Notifications.getPermissionsAsync();
    return {
      granted: result.granted,
      status: result.status,
    };
  }

  async requestPermission(): Promise<{ granted: boolean }> {
    if (!this.isAvailable()) {
      return { granted: false };
    }
    const result = await Notifications.requestPermissionsAsync();
    return { granted: result.granted };
  }

  async scheduleForCircle(
    circle: Circle,
    privacy: NotificationPrivacy = 'private',
    personName?: string
  ): Promise<void> {
    if (!this.isAvailable()) return;
    const identifier = circleNotificationId(circle.id);

    // Cancel any existing notification for this circle
    await this.cancelForCircle(circle.id);

    const days = REMINDER_FREQUENCY_DAYS[circle.reminderFrequency];
    const intervalSeconds = days * 24 * 60 * 60;

    const body =
      privacy === 'detailed' && personName
        ? `Maybe reach out to ${personName} today.`
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
      // Notification may not exist — that's fine
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
