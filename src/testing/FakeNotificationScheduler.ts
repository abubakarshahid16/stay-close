/**
 * In-memory NotificationScheduler for tests.
 *
 * Records every call so reconciliation can be asserted precisely — including
 * that it does NOT re-schedule something already correct, which is the
 * difference between idempotent and merely working.
 */
import type {
  NotificationContent,
  NotificationPermission,
  NotificationPermissionState,
  NotificationScheduler,
  ScheduledNotification,
} from '../ports/NotificationScheduler';
import type { Instant, ReminderId } from '../domain/shared/ids';

export interface ScheduledEntry {
  readonly id: ReminderId;
  readonly at: Instant;
  readonly content: NotificationContent;
}

export class FakeNotificationScheduler implements NotificationScheduler {
  private entries = new Map<ReminderId, ScheduledEntry>();
  private state: NotificationPermissionState = 'granted';
  private askAgain = true;

  /** Every scheduleAt call, including replacements. */
  readonly scheduleCalls: ScheduledEntry[] = [];
  readonly cancelCalls: ReminderId[] = [];

  setPermission(state: NotificationPermissionState, canAskAgain = true): void {
    this.state = state;
    this.askAgain = canAskAgain;
  }

  /** Model the OS having lost pending notifications, e.g. across a reboot. */
  simulateOsWipe(): void {
    this.entries.clear();
  }

  /** Model a stray notification the OS still holds for a resolved reminder. */
  seed(id: ReminderId, at: Instant, content: NotificationContent): void {
    this.entries.set(id, { id, at, content });
  }

  get scheduledCount(): number {
    return this.entries.size;
  }

  scheduledFor(id: ReminderId): ScheduledEntry | undefined {
    return this.entries.get(id);
  }

  async permission(): Promise<NotificationPermission> {
    return { state: this.state, canAskAgain: this.askAgain };
  }

  async request(): Promise<NotificationPermission> {
    return this.permission();
  }

  async scheduleAt(id: ReminderId, at: Instant, content: NotificationContent): Promise<void> {
    // Replaces rather than stacks, matching the real adapter.
    this.entries.set(id, { id, at, content });
    this.scheduleCalls.push({ id, at, content });
  }

  async cancel(id: ReminderId): Promise<void> {
    this.entries.delete(id);
    this.cancelCalls.push(id);
  }

  async listScheduled(): Promise<readonly ScheduledNotification[]> {
    return [...this.entries.values()].map((entry) => ({ id: entry.id, at: entry.at }));
  }
}
