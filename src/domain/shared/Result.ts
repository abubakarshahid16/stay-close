/**
 * Result — explicit success/failure as a value.
 *
 * Domain operations that can fail return a Result rather than throwing, so that
 * invalid state transitions are assertable in tests instead of being caught.
 * See docs/ARCHITECTURE.md §6.
 */

export type Result<T, E = DomainError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

export function isOk<T, E>(
  result: Result<T, E>
): result is { readonly ok: true; readonly value: T } {
  return result.ok;
}

export function isErr<T, E>(
  result: Result<T, E>
): result is { readonly ok: false; readonly error: E } {
  return !result.ok;
}

/**
 * Unwrap a Result, throwing if it is an error.
 * Intended for tests and for call sites that have already checked `ok`.
 */
export function unwrap<T, E>(result: Result<T, E>): T {
  if (result.ok) return result.value;
  throw new Error(`unwrap called on error Result: ${JSON.stringify(result.error)}`);
}

/** Domain error codes. Exhaustive — add a member rather than using a bare string. */
export type DomainErrorCode =
  // validation
  | 'INVALID_GROUP_NAME'
  | 'INVALID_SCHEDULE'
  | 'INVALID_PHONE_NUMBER'
  | 'INVALID_PEOPLE_PER_CYCLE'
  // reminder state machine
  | 'INVALID_TRANSITION'
  | 'REMINDER_ALREADY_RESOLVED'
  // membership
  | 'DUPLICATE_MEMBERSHIP'
  | 'MEMBERSHIP_NOT_FOUND'
  // contacts
  | 'CONTACT_UNAVAILABLE'
  // not found
  | 'NOT_FOUND';

export interface DomainError {
  readonly code: DomainErrorCode;
  /** Human-readable detail. Never contains a phone number or contact name. */
  readonly detail: string;
}

export function domainError(code: DomainErrorCode, detail: string): DomainError {
  return { code, detail };
}
