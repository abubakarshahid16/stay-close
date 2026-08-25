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

export class WebContactProvider implements ContactProvider {
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
   * Browsers have no address book, so there is no picker to present.
   *
   * The Contact Picker API exists in Chrome on Android only, behind a secure
   * context, and is not available in Safari or on desktop. Claiming support
   * here and failing on most browsers would be worse than saying no: the web
   * build asks people to type a name and number, and says so.
   */
  async pickOne(): Promise<null> {
    return null;
  }

  async list(): Promise<readonly ResolvedContact[]> {
    return [];
  }
}
