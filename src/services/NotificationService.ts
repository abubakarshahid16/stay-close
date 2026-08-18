import * as Notifications from 'expo-notifications';
import type { Circle } from '../types/circle';
import { REMINDER_FREQUENCY_DAYS } from '../types/circle';
import type { NotificationPrivacy } from '../types/settings';

const NOTIFICATION_HOUR = 9; // 9:00 AM local time

function circleNotificationId(circleId: number): string {
  return `circle-reminder-${circleId}`;
}

export class NotificationService {
  async getPermissionStatus(): Promise<{ granted: boolean; status: string }> {
    const result = await Notifications.getPermissionsAsync();
    return {
      granted: result.granted,
      status: result.status,
    };
  }

  async requestPermission(): Promise<{ granted: boolean }> {
    const result = await Notifications.requestPermissionsAsync();
    return { granted: result.granted };
  }

  async scheduleForCircle(
    circle: Circle,
    privacy: NotificationPrivacy = 'private',
    personName?: string
  ): Promise<void> {
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
    try {
      await Notifications.cancelScheduledNotificationAsync(
        circleNotificationId(circleId)
      );
    } catch {
      // Notification may not exist — that's fine
    }
  }

  async cancelAll(): Promise<void> {
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
