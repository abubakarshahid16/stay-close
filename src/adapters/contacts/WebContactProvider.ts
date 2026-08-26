/**
 * ContactProvider for web — and an honest one.
 *
 * **There is no address-book API in a browser.** No W3C Contacts standard is
 * implemented broadly enough to use, so a web build genuinely cannot read the
 * user's contacts. This is a platform fact, not a gap in the implementation.
 *
 * Rather than fake it, this reports `unavailable`, which the add-people screen
 * treats as "offer manual entry instead". Every other part of the app is
 * unaffected: a ContactReference created by hand is identical to one imported
 * from a device, because identity anchors on the phone number rather than a
 * platform id (docs/DATABASE.md §2.1).
 *
 * The consequence to be clear-eyed about: on web the user types people in once,
 * and contact sync can never repair a stale name or number, because there is
 * nothing to sync against.
 */
import type {
  ContactPermission,
  ContactProvider,
  ResolvedContact,
} from '../../ports/ContactProvider';
import type { NativeContactId } from '../../domain/shared/ids';
import { normaliseToE164 } from '../../domain/contact/phone';

/**
 * The Contact Picker API, which is not in the DOM lib because it is not a
 * baseline feature. Declared narrowly: only the two properties this asks for.
 */
interface ContactsManagerLike {
  select(
    properties: readonly ('name' | 'tel')[],
    options?: { multiple?: boolean }
  ): Promise<{ name?: string[]; tel?: string[] }[]>;
}

type NavigatorWithContacts = Navigator & { contacts?: ContactsManagerLike };

export class WebContactProvider implements ContactProvider {
  readonly kind = 'web' as const;

  /**
   * @param defaultCallingCode Region for normalising a nationally-formatted
   *   number returned by the picker, exactly as the native provider does.
   */
  constructor(private readonly defaultCallingCode?: string) {}

  async permission(): Promise<ContactPermission> {
    // Not 'denied': nothing was refused, and offering a "grant access" button
    // that cannot work would be worse than saying the capability is absent.
    return { state: 'unavailable', canAskAgain: false };
  }

  async request(): Promise<ContactPermission> {
    return this.permission();
  }

  async resolve(_nativeId: NativeContactId): Promise<ResolvedContact | null> {
    return null;
  }

  async findByPhone(_e164: string): Promise<ResolvedContact | null> {
    return null;
  }

  /**
   * Whether this browser implements the Contact Picker API.
   *
   * Chrome on Android does; Safari, Firefox and every desktop browser do not,
   * and Apple has not implemented it, so an iPhone will always be false here.
   * Feature-detected rather than sniffed from the user agent, which is the only
   * way to be right about this as browsers change.
   *
   * Also requires a secure context and a top-level frame, both of which the
   * detection covers implicitly: `navigator.contacts` is not exposed otherwise.
   */
  canPick(): boolean {
    if (typeof navigator === 'undefined') return false;
    const manager = (navigator as NavigatorWithContacts).contacts;
    return typeof manager?.select === 'function';
  }

  /**
   * The browser's own contact picker, where one exists.
   *
   * This is not reading the address book — the same distinction as the native
   * picker. The browser shows the list, the user chooses, and the page receives
   * only who they chose. There is no permission prompt and no ongoing access,
   * which is why it is available at all.
   *
   * Returns null where unsupported, on cancellation, or if the browser refuses.
   * The caller falls back to manual entry, so a browser without the API behaves
   * exactly as it did before.
   */
  async pickOne(): Promise<ResolvedContact | null> {
    if (!this.canPick()) return null;

    try {
      const manager = (navigator as NavigatorWithContacts).contacts;
      // Must be called from a user gesture; the screen calls it from a press.
      const selected = await manager!.select(['name', 'tel'], { multiple: false });
      const first = selected?.[0];
      if (!first) return null; // cancelled

      const displayName = (first.name ?? []).find((n) => n && n.trim().length > 0)?.trim();
      const numbers = (first.tel ?? []).filter((t) => typeof t === 'string' && t.trim().length > 0);
      if (!displayName && numbers.length === 0) return null;

      const phones = numbers.map((raw) => {
        const normalised = normaliseToE164(raw, this.defaultCallingCode);
        return { raw, e164: normalised.ok ? normalised.e164 : null };
      });

      // No stable identifier is exposed by this API, and nothing durable could
      // be invented from a one-off selection. Identity anchors on the phone
      // number anyway (docs/DATABASE.md 2.1), so null is correct rather than
      // lossy.
      return {
        nativeId: null as unknown as NativeContactId,
        displayName: displayName ?? numbers[0],
        phones,
      };
    } catch {
      return null;
    }
  }

  async list(): Promise<readonly ResolvedContact[]> {
    return [];
  }
}
