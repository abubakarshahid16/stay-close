/**
 * Contact synchronisation (issue 012 / #23).
 *
 * Keeps stored ContactReferences aligned with the native address book, which
 * remains the source of truth (docs/DOMAIN.md §2).
 *
 * The resolution ladder is the whole point, and its order matters:
 *
 *   1. resolve by nativeId          — the fast path
 *   2. on miss, find by phoneE164   — repairs a churned identifier
 *   3. on miss, mark unavailable    — the person really is gone
 *
 * Step 2 exists because identifier churn is *expected*: Android rewrites `_ID`
 * on aggregation or account sync, and iOS identifiers are device-local and lost
 * on restore (docs/PLATFORM.md §1.3). Without it, an ordinary iCloud sync would
 * look like every contact being deleted.
 *
 * Nothing here ever deletes. A person who leaves the address book becomes
 * `unavailable`; their history and memberships are untouched.
 */
import type { Clock } from '../../ports/Clock';
import type { ContactProvider, ResolvedContact } from '../../ports/ContactProvider';
import type { UnitOfWork } from '../../ports/repositories';
import type { ContactReference } from '../../domain/entities';

export interface SyncOutcome {
  readonly checked: number;
  /** Display name or number refreshed from the native record. */
  readonly updated: number;
  /** Stale nativeId repaired by matching on phone number. */
  readonly repaired: number;
  /** Could not be resolved at all; excluded from future selection. */
  readonly markedUnavailable: number;
  /** Previously unavailable and now resolvable again. */
  readonly restored: number;
  /** True when permission was missing, so nothing was concluded. */
  readonly skipped: boolean;
}

const EMPTY_OUTCOME: SyncOutcome = {
  checked: 0,
  updated: 0,
  repaired: 0,
  markedUnavailable: 0,
  restored: 0,
  skipped: true,
};

export class SyncContactReferences {
  constructor(
    private readonly uow: UnitOfWork,
    private readonly contacts: ContactProvider,
    private readonly clock: Clock
  ) {}

  async run(): Promise<SyncOutcome> {
    const permission = await this.contacts.permission();

    // Without read access we cannot distinguish "deleted" from "invisible".
    // Concluding anything here would wrongly mark the whole address book
    // unavailable, so we do nothing at all (docs/DOMAIN.md §2.1).
    if (permission.state !== 'granted' && permission.state !== 'limited') {
      return EMPTY_OUTCOME;
    }

    const stored = await this.uow.repositories.contacts.findAll();
    const now = this.clock.now();

    let updated = 0;
    let repaired = 0;
    let markedUnavailable = 0;
    let restored = 0;

    for (const reference of stored) {
      const resolution = await this.resolveOne(reference);

      if (!resolution) {
        if (reference.availability !== 'unavailable') {
          await this.uow.repositories.contacts.setAvailability(reference.id, 'unavailable', now);
          markedUnavailable++;
        }
        continue;
      }

      const { contact, viaPhone } = resolution;

      if (viaPhone) {
        await this.uow.repositories.contacts.repairNativeId(reference.id, contact.nativeId, now);
        repaired++;
      }

      if (await this.refreshSnapshot(reference, contact, now)) updated++;

      if (reference.availability === 'unavailable') {
        await this.uow.repositories.contacts.setAvailability(reference.id, 'available', now);
        restored++;
      }
    }

    return {
      checked: stored.length,
      updated,
      repaired,
      markedUnavailable,
      restored,
      skipped: false,
    };
  }

  /** The three-step ladder from the module comment. */
  private async resolveOne(
    reference: ContactReference
  ): Promise<{ contact: ResolvedContact; viaPhone: boolean } | null> {
    if (reference.nativeId !== null) {
      const byId = await this.contacts.resolve(reference.nativeId);
      if (byId) return { contact: byId, viaPhone: false };
    }

    const byPhone = await this.contacts.findByPhone(reference.phoneE164);
    if (byPhone) return { contact: byPhone, viaPhone: true };

    return null;
  }

  /**
   * Refresh the cached display name and preferred number.
   *
   * The stored phoneE164 is only replaced when the native record still carries
   * it, or when it has genuinely disappeared. That number is the durable
   * identity key and is UNIQUE in the schema, so overwriting it casually could
   * collide with another person's row.
   */
  private async refreshSnapshot(
    reference: ContactReference,
    contact: ResolvedContact,
    now: ReturnType<Clock['now']>
  ): Promise<boolean> {
    const numbers = contact.phones.map((p) => p.e164).filter((n): n is string => n !== null);
    const stillPresent = numbers.includes(reference.phoneE164);
    const nextPhone = stillPresent ? reference.phoneE164 : (numbers[0] ?? reference.phoneE164);
    const nextName = contact.displayName.trim() || reference.displayNameCache;

    if (nextName === reference.displayNameCache && nextPhone === reference.phoneE164) {
      return false;
    }

    // A number change that would collide with an existing person is skipped
    // rather than allowed to throw on the UNIQUE constraint.
    if (nextPhone !== reference.phoneE164) {
      const clash = await this.uow.repositories.contacts.findByPhone(nextPhone);
      if (clash && clash.id !== reference.id) {
        if (nextName === reference.displayNameCache) return false;
        await this.uow.repositories.contacts.updateSnapshot(
          reference.id,
          nextName,
          reference.phoneE164,
          now
        );
        return true;
      }
    }

    await this.uow.repositories.contacts.updateSnapshot(reference.id, nextName, nextPhone, now);
    return true;
  }
}
