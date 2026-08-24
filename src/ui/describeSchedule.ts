/**
 * Human-readable schedule summary.
 *
 * Deliberately avoids ambiguous vocabulary — never "bi-weekly"
 * (docs/DOMAIN.md §4.2) — and states the people-per-cycle count, because that
 * is the part users most often misread: "2 people every 7 days" selects two
 * people each week, it does not promise each person is contacted weekly (§4.1).
 */
import type { Schedule } from '../domain/entities';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function ordinal(day: number): string {
  const suffix =
    day % 10 === 1 && day !== 11
      ? 'st'
      : day % 10 === 2 && day !== 12
        ? 'nd'
        : day % 10 === 3 && day !== 13
          ? 'rd'
          : 'th';
  return `${day}${suffix}`;
}

function timeOfDay(schedule: Schedule): string {
  const hh = String(schedule.hour).padStart(2, '0');
  const mm = String(schedule.minute).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function describeCadence(schedule: Schedule): string {
  switch (schedule.cadence) {
    case 'daily':
      return 'every day';
    case 'every_x_days':
      return schedule.intervalCount === 1
        ? 'every day'
        : `every ${schedule.intervalCount} days`;
    case 'weekly':
      return `every ${WEEKDAYS[schedule.weekday ?? 0]}`;
    case 'every_x_weeks':
      return schedule.intervalCount === 1
        ? `every ${WEEKDAYS[schedule.weekday ?? 0]}`
        : `every ${schedule.intervalCount} weeks on ${WEEKDAYS[schedule.weekday ?? 0]}`;
    case 'monthly':
      return `on the ${ordinal(schedule.monthDay ?? 1)} of each month`;
  }
}

export function describeSchedule(schedule: Schedule): string {
  const who =
    schedule.peoplePerCycle === 1 ? '1 person' : `${schedule.peoplePerCycle} people`;
  const paused = schedule.active ? '' : ' (paused)';
  return `${who} ${describeCadence(schedule)} at ${timeOfDay(schedule)}${paused}`;
}

/**
 * The clarification that belongs next to a schedule the user is configuring.
 * Only shown when it could actually mislead — with one person per cycle there
 * is nothing to misread.
 */
export function cyclesCaveat(schedule: Schedule, memberCount: number): string | null {
  if (schedule.peoplePerCycle >= memberCount || memberCount === 0) return null;
  return `Stay Close picks ${
    schedule.peoplePerCycle === 1 ? 'one person' : `${schedule.peoplePerCycle} people`
  } each time — not everyone. With ${memberCount} in this group, each person comes up roughly every ${Math.max(
    1,
    Math.round(memberCount / schedule.peoplePerCycle)
  )} cycles.`;
}
