/**
 * ContactProvider port — the device address book.
 *
 * Two design points come straight from docs/PLATFORM.md:
 *
 * 1. `limited` is a first-class permission state. iOS 18 reports
 *    status 'granted' while exposing only a user-selected subset, so
 *    collapsing it into `granted` would look like silent contact loss
 *    (§1.2).
 * 2. `findByPhone` exists to repair native-identifier churn. Android changes
 *    `_ID` on aggregation/sync and iOS identifiers are device-local, so
 *    `nativeId` is a fast path, not a durable key (§1.3).
 */
import type { NativeContactId } from '../domain/shared/ids';

export type ContactPermissionState =
  | 'granted' // full access to the address book
  | 'limited' // iOS 18+: only user-selected contacts are visible
  | 'denied'
  | 'restricted' // iOS reports this as denied; inferred from canAskAgain
  | 'undetermined'
  | 'unavailable'; // no contacts capability on this platform at all

export interface ContactPermission {
  readonly state: ContactPermissionState;
  /** False means the OS will not show the prompt again — a terminal state. */
  readonly canAskAgain: boolean;
}

export interface ResolvedContactPhone {
  /** Normalised E.164, e.g. "+447700900123". Null when unparseable. */
  readonly e164: string | null;
  /** As stored on the device, for display only. */
  readonly raw: string;
  readonly label?: string;
}

export interface ResolvedContact {
  readonly nativeId: NativeContactId;
  readonly displayName: string;
  readonly phones: readonly ResolvedContactPhone[];
}

export interface ListContactsOptions {
  readonly limit?: number;
  readonly offset?: number;
  /** Substring match on display name. */
  readonly nameQuery?: string;
}

export interface ContactProvider {
  permission(): Promise<ContactPermission>;
  request(): Promise<ContactPermission>;

  /**
   * Resolve one contact by platform identifier.
   * Returns null when the contact is missing, deleted, merged away, or
   * unshared under limited access. Never throws for absence.
   */
  resolve(nativeId: NativeContactId): Promise<ResolvedContact | null>;

  /**
   * Find a contact by normalised E.164 number. Used to repair a stale
   * nativeId (docs/DOMAIN.md §1.1). Returns null when no contact matches.
   */
  findByPhone(e164: string): Promise<ResolvedContact | null>;

  list(options?: ListContactsOptions): Promise<readonly ResolvedContact[]>;

  /**
   * Ask the OS to show its own contact picker and return the chosen person.
   *
   * Materially different from `list()`, and the difference is the point. `list()`
   * reads the whole address book, which is why it needs READ_CONTACTS. This
   * hands the choice to the operating system: the OS renders the list, the user
   * picks one, and the app receives only that person. The app never sees anyone
   * the user did not choose.
   *
   * It therefore works when the contacts permission has been declined, which is
   * the state a user can otherwise be stuck in — Android stops prompting after
   * two refusals, and from then on `list()` can never succeed.
   *
   * @returns the chosen contact, or null if the user cancelled or the platform
   *   has no picker (a browser has no address book at all).
   */
  pickOne(): Promise<ResolvedContact | null>;
}
