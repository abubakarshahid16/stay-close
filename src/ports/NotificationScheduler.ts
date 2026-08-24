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

  /** Every reminder id currently registered with the OS. Used for drift repair. */
  listScheduled(): Promise<readonly ReminderId[]>;
}
