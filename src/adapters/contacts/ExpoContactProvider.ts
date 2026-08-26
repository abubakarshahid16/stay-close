/**
 * ContactProvider backed by expo-contacts (SDK 57 class-based API).
 *
 * Written against the installed type definitions, not the prose docs — see
 * docs/PLATFORM.md §1. Three behaviours are load-bearing:
 *
 * 1. `limited` is reported as a distinct state. iOS 18 returns
 *    status 'granted' with accessPrivileges 'limited', exposing only a
 *    user-selected subset. Collapsing that into 'granted' would look like the
 *    app silently losing contacts (§1.2).
 * 2. `getDetails()` THROWS when a contact is missing or merged away, unlike the
 *    legacy API which returned undefined. Every read is wrapped so absence
 *    becomes null, never an unhandled rejection (§1.4).
 * 3. iOS reports `restricted` as `denied` with no distinguishing status, so a
 *    terminal state is inferred from `canAskAgain` (§1.2).
 *
 * Cannot be unit-tested without a device; FakeContactProvider covers the
 * use-case tests. Kept deliberately thin so there is little here to be wrong.
 */
import {
  Contact,
  ContactField,
  getPermissionsAsync,
  requestPermissionsAsync,
  type ContactsPermissionResponse,
} from 'expo-contacts';
import type {
  ContactPermission,
  ContactPermissionState,
  ContactProvider,
  ListContactsOptions,
  ResolvedContact,
} from '../../ports/ContactProvider';
import { nativeContactId, type NativeContactId } from '../../domain/shared/ids';
import { normaliseToE164 } from '../../domain/contact/phone';

/** Narrow field list. Fetching all fields has a history of iOS crashes (§1.6). */
const FIELDS = [ContactField.FULL_NAME, ContactField.PHONES] as const;

interface DetailsShape {
  fullName?: string | null;
  phones?: { number?: string | null; label?: string | null }[] | null;
}

export class ExpoContactProvider implements ContactProvider {
  readonly kind = 'native' as const;

  /**
   * @param defaultCallingCode Region for normalising national-format numbers.
   *   Derived from device locale by the caller; without it, national numbers
   *   are rejected rather than guessed (see phone.ts).
   */
  constructor(private readonly defaultCallingCode?: string) {}

  async permission(): Promise<ContactPermission> {
    return mapPermission(await getPermissionsAsync());
  }

  async request(): Promise<ContactPermission> {
    return mapPermission(await requestPermissionsAsync());
  }

  async resolve(id: NativeContactId): Promise<ResolvedContact | null> {
    try {
      const contact = new Contact(id);
      const details = (await contact.getDetails(FIELDS)) as DetailsShape;
      return this.toResolved(id, details);
    } catch {
      // Deleted, merged, or unshared under limited access. All are "absent".
      return null;
    }
  }

  async findByPhone(e164: string): Promise<ResolvedContact | null> {
    // Repairs a churned nativeId (§1.3). There is no native query-by-number, so
    // this scans and compares normalised numbers. Only reached on a resolve
    // miss, which is rare.
    const all = await this.list();
    for (const candidate of all) {
      if (candidate.phones.some((p) => p.e164 === e164)) return candidate;
    }
    return null;
  }

  async list(options?: ListContactsOptions): Promise<readonly ResolvedContact[]> {
    try {
      const rows = (await Contact.getAllDetails(FIELDS, {
        limit: options?.limit,
        offset: options?.offset,
        name: options?.nameQuery,
      })) as (DetailsShape & { id?: string })[];

      const out: ResolvedContact[] = [];
      for (const row of rows) {
        if (!row.id) continue;
        const resolved = this.toResolved(nativeContactId(row.id), row);
        if (resolved) out.push(resolved);
      }
      return out;
    } catch {
      // Permission revoked mid-session, or the platform refused. Degrade to
      // empty rather than crashing (docs/DOMAIN.md §2.1).
      return [];
    }
  }

  /**
   * The OS's own contact picker.
   *
   * Deliberately does NOT check or request permission first. Nothing in the
   * expo-contacts Android bridge guards presentPicker or getDetails with
   * ensurePermissions() — unlike getAll — because the user is choosing the
   * contact in a system UI rather than the app reading the address book.
   *
   * That makes this the one route to adding someone that still works after the
   * contacts permission has been refused for good, which Android allows after
   * two declines.
   *
   * Whether reading the picked contact's number then succeeds without
   * READ_CONTACTS is a platform question this cannot answer from source: after
   * ACTION_PICK, Android grants read access to the returned URI, but Expo
   * rebuilds the contact from its id through the content resolver. If the read
   * is refused, this returns null and the caller falls back to manual entry
   * rather than failing.
   */
  async pickOne(): Promise<ResolvedContact | null> {
    try {
      const picked = await Contact.presentPicker();
      if (!picked) return null; // cancelled

      const details = (await picked.getDetails(FIELDS)) as DetailsShape;
      return this.toResolved(nativeContactId(String(picked.id)), details);
    } catch {
      return null;
    }
  }

  private toResolved(id: NativeContactId, details: DetailsShape): ResolvedContact | null {
    const displayName = (details.fullName ?? '').trim();
    if (displayName.length === 0) return null;

    const phones = (details.phones ?? [])
      .map((p) => (p?.number ?? '').trim())
      .filter((raw) => raw.length > 0)
      .map((raw) => {
        const result = normaliseToE164(raw, this.defaultCallingCode);
        return { e164: result.ok ? result.e164 : null, raw };
      });

    return { nativeId: id, displayName, phones };
  }
}

function mapPermission(response: ContactsPermissionResponse): ContactPermission {
  return {
    state: mapPermissionState(response),
    canAskAgain: response.canAskAgain ?? false,
  };
}

function mapPermissionState(response: ContactsPermissionResponse): ContactPermissionState {
  if (response.status === 'granted') {
    // The critical branch: 'granted' alone does not mean full access.
    return response.accessPrivileges === 'limited' ? 'limited' : 'granted';
  }
  if (response.status === 'denied') {
    // iOS collapses restricted into denied. canAskAgain === false means the OS
    // will not prompt again, which is what 'restricted' means for our purposes.
    return response.canAskAgain ? 'denied' : 'restricted';
  }
  return 'undetermined';
}
