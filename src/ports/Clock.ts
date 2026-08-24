/**
 * Clock port.
 *
 * Cycle times are local wall-clock while stored instants are UTC
 * (docs/DOMAIN.md §13). DST transitions, timezone changes and month-boundary
 * clamping are all domain logic, so they must be testable at arbitrary
 * instants.
 *
 * No domain or application code may read the system clock directly.
 * Tests inject FakeClock; production injects SystemClock.
 */
import type { Instant, TimeZoneId } from '../domain/shared/ids';

export interface Clock {
  /** Current absolute time, UTC. */
  now(): Instant;
  /** The device's current IANA timezone. May change between calls. */
  timeZone(): TimeZoneId;
}
