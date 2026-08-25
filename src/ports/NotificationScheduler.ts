/**
 * NotificationScheduler port — local notifications only.
 *
 * Design constraints from docs/PLATFORM.md §2:
 *
 * - Only absolute DATE-style scheduling is exposed. Repeating OS triggers
 *   cannot express rotation, because *who* a reminder is about changes every
 *   cycle.
 * - Identity is the ReminderId, giving a 1:1 mapping between a database row
 *   and an OS notification. That is what makes idempotence checkable.
 * - `listScheduled` is not a convenience: it is how reconciliation detects
 *   drift between the database and the OS after a reboot, a force-quit, or a
 *   silently dropped request past the iOS 64-notification cap.
 */
import type { Instant, ReminderId } from '../domain/shared/ids';

export type NotificationPermissionState =
  | 'granted'
  | 'denied'
  | 'undetermined'
  | 'unavailable';

export interface NotificationPermission {
  readonly state: NotificationPermissionState;
  readonly canAskAgain: boolean;
}

export interface NotificationContent {
  readonly title: string;
  readonly body: string;
}

/**
 * A notification the OS currently holds for us.
 *
 * The time is part of this on purpose. Reconciliation has to detect *time*
 * drift, not just presence: when a reminder is snoozed its due time moves, and
 * a presence-only check would happily leave the old notification in place to
 * fire at the original moment.
 */
export interface ScheduledNotification {
  readonly id: ReminderId;
  readonly at: Instant;
}

export interface NotificationScheduler {
  permission(): Promise<NotificationPermission>;
  request(): Promise<NotificationPermission>;

  /**
   * Schedule a one-shot notification at an absolute instant, keyed by
   * reminder. Scheduling the same ReminderId twice must replace, not
   * duplicate.
   */
  scheduleAt(id: ReminderId, at: Instant, content: NotificationContent): Promise<void>;

  /** Cancel by reminder. Must not throw when nothing is scheduled. */
  cancel(id: ReminderId): Promise<void>;

  /**
   * Deliver one notification shortly from now, unrelated to any reminder.
   *
   * Exists so a user can find out whether notifications reach this device
   * WITHOUT waiting for a real reminder to come due. That gap is the whole
   * problem: a schedule can be days away, and until it fires there is nothing
   * to distinguish "working" from "silently blocked by the OS" — which is the
   * state this app shipped in.
   *
   * Not keyed by ReminderId, so reconciliation neither knows nor cancels it.
   *
   * @returns false when the platform declined to deliver, so the caller can say
   *   so rather than claim success.
   */
  sendTest(content: NotificationContent): Promise<boolean>;

  /**
   * Everything currently registered with the OS, with its scheduled time.
   * Used for drift repair — see ScheduledNotification.
   */
  listScheduled(): Promise<readonly ScheduledNotification[]>;
}
