/**
 * Production Clock. The only place in the codebase permitted to read the
 * system clock or the device timezone.
 */
import type { Clock } from '../../ports/Clock';
import { instant, timeZoneId, type Instant, type TimeZoneId } from '../../domain/shared/ids';

export class SystemClock implements Clock {
  now(): Instant {
    return instant(Date.now());
  }

  timeZone(): TimeZoneId {
    // Resolved per call: the device timezone can change while the app runs,
    // and future cycles must follow the change (docs/DOMAIN.md §13).
    return timeZoneId(Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC');
  }
}
