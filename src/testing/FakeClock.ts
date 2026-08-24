/**
 * FakeClock — controllable time for tests.
 *
 * Every domain and application test uses this. No test may depend on the real
 * current time (docs/DOMAIN.md §13, docs/ARCHITECTURE.md §7).
 */
import type { Clock } from '../ports/Clock';
import {
  instant,
  instantFromISO,
  timeZoneId,
  type Instant,
  type TimeZoneId,
} from '../domain/shared/ids';

export class FakeClock implements Clock {
  private current: Instant;
  private zone: TimeZoneId;

  constructor(at: Instant | string, zone = 'UTC') {
    this.current = typeof at === 'string' ? instantFromISO(at) : at;
    this.zone = timeZoneId(zone);
  }

  now(): Instant {
    return this.current;
  }

  timeZone(): TimeZoneId {
    return this.zone;
  }

  /** Move time forward. Negative values are allowed, to model a clock going backwards. */
  advance(ms: number): void {
    this.current = instant(this.current + ms);
  }

  advanceDays(days: number): void {
    this.advance(days * 24 * 60 * 60 * 1000);
  }

  set(at: Instant | string): void {
    this.current = typeof at === 'string' ? instantFromISO(at) : at;
  }

  /** Model the user flying to another timezone. */
  setTimeZone(zone: string): void {
    this.zone = timeZoneId(zone);
  }
}
