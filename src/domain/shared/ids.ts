/**
 * Branded identifiers.
 *
 * These are compile-time-only wrappers over primitives. They cost nothing at
 * runtime but make it impossible to pass a GroupId where a ReminderId is
 * expected — a real class of bug in a system with this many numeric ids.
 */

declare const brand: unique symbol;

type Brand<T, B extends string> = T & { readonly [brand]: B };

export type GroupId = Brand<number, 'GroupId'>;
export type ContactReferenceId = Brand<number, 'ContactReferenceId'>;
export type MembershipId = Brand<number, 'MembershipId'>;
export type ScheduleId = Brand<number, 'ScheduleId'>;
export type ReminderId = Brand<number, 'ReminderId'>;
export type ContactEventId = Brand<number, 'ContactEventId'>;

/** The platform's contact identifier. Not durable — see docs/PLATFORM.md §1.3. */
export type NativeContactId = Brand<string, 'NativeContactId'>;

/** An absolute point in time, milliseconds since the Unix epoch, UTC. */
export type Instant = Brand<number, 'Instant'>;

/** IANA timezone identifier, e.g. "Europe/London". */
export type TimeZoneId = Brand<string, 'TimeZoneId'>;

export const groupId = (n: number): GroupId => n as GroupId;
export const contactReferenceId = (n: number): ContactReferenceId => n as ContactReferenceId;
export const membershipId = (n: number): MembershipId => n as MembershipId;
export const scheduleId = (n: number): ScheduleId => n as ScheduleId;
export const reminderId = (n: number): ReminderId => n as ReminderId;
export const contactEventId = (n: number): ContactEventId => n as ContactEventId;
export const nativeContactId = (s: string): NativeContactId => s as NativeContactId;
export const instant = (ms: number): Instant => ms as Instant;
export const timeZoneId = (s: string): TimeZoneId => s as TimeZoneId;

/** Convenience for tests and logging. Never used for storage. */
export const instantToISO = (i: Instant): string => new Date(i).toISOString();
export const instantFromISO = (iso: string): Instant => instant(new Date(iso).getTime());
