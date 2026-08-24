/**
 * Schedule use cases (issues 016 / #27, 017 / #28).
 *
 * The editing rule from docs/DOMAIN.md §4.4 is the point of this module:
 * changing a schedule affects only FUTURE cycles. Past occurrences and the
 * reminders they produced are never rewritten — history records what the app
 * actually asked, not what it would ask under today's settings.
 *
 * That falls out of one decision: an edit does not touch `schedule_occurrences`.
 * Already-processed cycles stay processed, so they are never regenerated under
 * the new configuration.
 */
import type { Clock } from '../../ports/Clock';
import type { UnitOfWork } from '../../ports/repositories';
import type { Schedule } from '../../domain/entities';
import { validateSchedule, type ScheduleSpec } from '../../domain/schedule/cadence';
import { domainError, err, ok, type Result } from '../../domain/shared/Result';
import type { GroupId, ScheduleId } from '../../domain/shared/ids';

export type ScheduleDraft = Omit<ScheduleSpec, 'anchorAt' | 'active'> & {
  readonly anchorAt?: Schedule['anchorAt'];
  readonly active?: boolean;
};

export type ScheduleEdit = Partial<Omit<ScheduleSpec, 'groupId' | 'anchorAt'>>;

export class ScheduleUseCases {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly clock: Clock
  ) {}

  async create(draft: ScheduleDraft): Promise<Result<Schedule>> {
    const group = await this.uow.repositories.groups.findById(draft.groupId);
    if (!group) {
      return err(domainError('NOT_FOUND', `Group ${draft.groupId} does not exist.`));
    }

    const now = this.clock.now();
    const spec: ScheduleSpec = {
      ...draft,
      anchorAt: draft.anchorAt ?? now,
      active: draft.active ?? true,
    };

    const validated = validateSchedule(spec);
    if (!validated.ok) return validated;

    // V1 exposes one active schedule per group (docs/DOMAIN.md §4.5). The data
    // model allows more, so this is a product rule enforced here rather than a
    // schema constraint that would block the future case.
    const existing = await this.uow.repositories.schedules.findByGroup(draft.groupId);
    if (existing.some((s) => s.active) && spec.active) {
      return err(
        domainError('INVALID_SCHEDULE', 'This group already has an active schedule.')
      );
    }

    return ok(await this.uow.repositories.schedules.create(validated.value, now));
  }

  async get(id: ScheduleId): Promise<Schedule | null> {
    return this.uow.repositories.schedules.findById(id);
  }

  async forGroup(groupId: GroupId): Promise<Schedule[]> {
    return this.uow.repositories.schedules.findByGroup(groupId);
  }

  /**
   * Edit a schedule. Future cycles use the new configuration; past ones are
   * untouched.
   *
   * The whole schedule is re-validated against the merged result rather than
   * just the changed fields, because the cross-field rules (weekday required
   * for weekly, forbidden for daily) can only be checked on the whole.
   */
  async edit(id: ScheduleId, patch: ScheduleEdit): Promise<Result<Schedule>> {
    const existing = await this.uow.repositories.schedules.findById(id);
    if (!existing) return err(domainError('NOT_FOUND', `Schedule ${id} does not exist.`));

    const merged: ScheduleSpec = {
      groupId: existing.groupId,
      peoplePerCycle: patch.peoplePerCycle ?? existing.peoplePerCycle,
      cadence: patch.cadence ?? existing.cadence,
      intervalCount: patch.intervalCount ?? existing.intervalCount,
      // Explicit null is meaningful here — it clears a weekday when switching
      // from weekly to daily — so `undefined` is the only "unchanged" marker.
      weekday: patch.weekday !== undefined ? patch.weekday : existing.weekday,
      monthDay: patch.monthDay !== undefined ? patch.monthDay : existing.monthDay,
      hour: patch.hour ?? existing.hour,
      minute: patch.minute ?? existing.minute,
      anchorAt: existing.anchorAt,
      active: patch.active ?? existing.active,
    };

    const validated = validateSchedule(merged);
    if (!validated.ok) return validated;

    await this.uow.repositories.schedules.update(
      id,
      {
        peoplePerCycle: merged.peoplePerCycle,
        cadence: merged.cadence,
        intervalCount: merged.intervalCount,
        weekday: merged.weekday,
        monthDay: merged.monthDay,
        hour: merged.hour,
        minute: merged.minute,
        active: merged.active,
      },
      this.clock.now()
    );

    return ok((await this.uow.repositories.schedules.findById(id)) as Schedule);
  }

  /** Pause without deleting. Future cycles stop; history is untouched. */
  async setActive(id: ScheduleId, active: boolean): Promise<Result<Schedule>> {
    return this.edit(id, { active });
  }

  /**
   * Delete a schedule and cancel the reminders it has not yet resolved.
   *
   * Cancellation runs first, for the same reason as group deletion: afterwards
   * those reminders have schedule_id = NULL and cannot be found by schedule.
   */
  async delete(id: ScheduleId): Promise<Result<{ cancelledReminders: number }>> {
    const existing = await this.uow.repositories.schedules.findById(id);
    if (!existing) return err(domainError('NOT_FOUND', `Schedule ${id} does not exist.`));

    const now = this.clock.now();
    const cancelled = await this.uow.transaction(async (repos) => {
      const count = await repos.reminders.cancelPendingForGroup(
        existing.groupId,
        'schedule_deleted',
        now
      );
      await repos.schedules.delete(id);
      return count;
    });

    return ok({ cancelledReminders: cancelled });
  }
}
