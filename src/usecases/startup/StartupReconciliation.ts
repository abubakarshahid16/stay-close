/**
 * Application startup reconciliation (issues 043 / #54, 044 / #55).
 *
 * Runs on every launch, so every step must be idempotent. Order matters:
 * contacts are synced before scheduling, or a cycle could select someone whose
 * contact has since been deleted.
 *
 * The resilience rule is the important part. Each step is isolated: a failure in
 * one is recorded and the rest still run. A notification permission problem must
 * not stop reminders being generated, and a contacts problem must not stop the
 * user seeing work they already have.
 *
 * And per docs/ARCHITECTURE.md §6: **no failure path here ever destroys user
 * history.** Corrupt or unopenable data surfaces an explicit recovery decision
 * for the user; it never auto-wipes.
 */
import type { UnitOfWork } from '../../ports/repositories';
import type { RunScheduler, SchedulerRunOutcome } from '../scheduler/RunScheduler';
import type { ReconcileNotifications, ReconcileNotificationsOutcome } from '../notifications/ReconcileNotifications';

export interface ContactSyncStep {
  run(): Promise<{
    checked: number;
    repaired: number;
    markedUnavailable: number;
    skipped: boolean;
  }>;
}

/** A step either produced a value or failed; a failure never aborts the launch. */
export type StepResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: string };

export interface StartupOutcome {
  readonly contacts: StepResult<{
    checked: number;
    repaired: number;
    markedUnavailable: number;
    skipped: boolean;
  }>;
  readonly scheduler: StepResult<SchedulerRunOutcome>;
  readonly notifications: StepResult<ReconcileNotificationsOutcome>;
  readonly pendingReminders: number;
  /** True when every step succeeded. */
  readonly healthy: boolean;
  /** Human-readable summary of what went wrong, for a diagnostics screen. */
  readonly problems: readonly string[];
}

async function attempt<T>(label: string, work: () => Promise<T>): Promise<StepResult<T>> {
  try {
    return { ok: true, value: await work() };
  } catch (error) {
    return {
      ok: false,
      error: `${label}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

export class StartupReconciliation {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly sync: ContactSyncStep,
    private readonly scheduler: RunScheduler,
    private readonly notifications: ReconcileNotifications
  ) {}

  async run(): Promise<StartupOutcome> {
    // 1. Align contact references with the address book, so scheduling does not
    //    select someone who has since gone.
    const contacts = await attempt('Contact sync', () => this.sync.run());

    // 2. Generate cycles that came due while the app was closed. Runs even if
    //    the contact sync failed — the schedule is still real, and rotation
    //    already excludes unavailable people.
    const scheduler = await attempt('Scheduler', () => this.scheduler.run());

    // 3. Bring OS notifications into line with the database.
    const notifications = await attempt('Notification reconciliation', () =>
      this.notifications.run()
    );

    // 4. Report outstanding work. Pending reminders are recovered simply by
    //    still being in the database — a missed notification never destroys the
    //    task (docs/DOMAIN.md §8.3).
    const pendingResult = await attempt('Pending reminders', async () =>
      (await this.uow.repositories.reminders.findPending()).length
    );

    const problems = [contacts, scheduler, notifications, pendingResult]
      .filter((step): step is { ok: false; error: string } => !step.ok)
      .map((step) => step.error);

    return {
      contacts,
      scheduler,
      notifications,
      pendingReminders: pendingResult.ok ? pendingResult.value : 0,
      healthy: problems.length === 0,
      problems,
    };
  }
}
