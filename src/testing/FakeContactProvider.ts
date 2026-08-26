/**
 * In-memory ContactProvider for tests.
 *
 * Lets the sync use case be tested against every awkward real-world case —
 * renamed contact, changed number, deleted contact, churned identifier, denied
 * or limited permission — none of which can be provoked on a device on demand.
 */
import type {
  ContactPermission,
  ContactPermissionState,
  ContactProvider,
  ListContactsOptions,
  ResolvedContact,
} from '../ports/ContactProvider';
import { nativeContactId, type NativeContactId } from '../domain/shared/ids';
import { normaliseToE164 } from '../domain/contact/phone';

export interface FakeContactSeed {
  readonly nativeId: string;
  readonly displayName: string;
  /** Raw numbers as a device would store them. */
  readonly numbers: readonly string[];
}

export class FakeContactProvider implements ContactProvider {
  readonly kind = 'fake' as const;

  pickCalls = 0;
  private pickResult: ResolvedContact | null = null;

  private contacts = new Map<string, ResolvedContact>();
  private permissionState: ContactPermissionState = 'granted';
  private askAgain = true;

  /** Numbers hidden from list() but still resolvable, modelling iOS limited access. */
  private unsharedIds = new Set<string>();

  constructor(seeds: readonly FakeContactSeed[] = [], private readonly callingCode = '44') {
    for (const seed of seeds) this.upsert(seed);
  }

  // ── test controls ────────────────────────────────────────────────────────

  upsert(seed: FakeContactSeed): void {
    this.contacts.set(seed.nativeId, {
      nativeId: nativeContactId(seed.nativeId),
      displayName: seed.displayName,
      phones: seed.numbers.map((raw) => {
        const result = normaliseToE164(raw, this.callingCode);
        return { e164: result.ok ? result.e164 : null, raw };
      }),
    });
  }

  /** Model the user deleting a contact from the address book. */
  remove(nativeId: string): void {
    this.contacts.delete(nativeId);
  }

  /** Model an OS identifier change: same person and number, new id. */
  churnId(oldId: string, newId: string): void {
    const existing = this.contacts.get(oldId);
    if (!existing) return;
    this.contacts.delete(oldId);
    this.contacts.set(newId, { ...existing, nativeId: nativeContactId(newId) });
  }

  setPermission(state: ContactPermissionState, canAskAgain = true): void {
    this.permissionState = state;
    this.askAgain = canAskAgain;
  }

  /** Hide a contact from list() while leaving it resolvable by id. */
  setUnshared(nativeId: string, unshared: boolean): void {
    if (unshared) this.unsharedIds.add(nativeId);
    else this.unsharedIds.delete(nativeId);
  }

  // ── port implementation ──────────────────────────────────────────────────

  async permission(): Promise<ContactPermission> {
    return { state: this.permissionState, canAskAgain: this.askAgain };
  }

  async request(): Promise<ContactPermission> {
    return this.permission();
  }

  async resolve(id: NativeContactId): Promise<ResolvedContact | null> {
    if (!this.hasAccess()) return null;
    return this.contacts.get(id) ?? null;
  }

  async findByPhone(e164: string): Promise<ResolvedContact | null> {
    if (!this.hasAccess()) return null;
    for (const contact of this.contacts.values()) {
      if (contact.phones.some((p) => p.e164 === e164)) return contact;
    }
    return null;
  }

  /**
   * Returns whatever `setPickResult` was given, so a test can model the user
   * choosing someone, cancelling, or the platform refusing the read.
   *
   * Deliberately ignores the permission state: the whole point of the picker is
   * that it works without one.
   */
  async pickOne(): Promise<ResolvedContact | null> {
    this.pickCalls += 1;
    return this.pickResult;
  }

  setPickResult(contact: ResolvedContact | null): void {
    this.pickResult = contact;
  }

  async list(options?: ListContactsOptions): Promise<readonly ResolvedContact[]> {
    if (!this.hasAccess()) return [];
    let all = [...this.contacts.values()].filter((c) => !this.unsharedIds.has(c.nativeId));
    if (options?.nameQuery) {
      const q = options.nameQuery.toLowerCase();
      all = all.filter((c) => c.displayName.toLowerCase().includes(q));
    }
    const offset = options?.offset ?? 0;
    return options?.limit === undefined ? all.slice(offset) : all.slice(offset, offset + options.limit);
  }

  private hasAccess(): boolean {
    return this.permissionState === 'granted' || this.permissionState === 'limited';
  }
}
