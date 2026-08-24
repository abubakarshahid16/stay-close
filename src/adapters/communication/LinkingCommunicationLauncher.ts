/**
 * CommunicationLauncher over OS deep links (issues 038 / #49, 039 / #50).
 *
 * Two decisions from docs/PLATFORM.md §5, both of which avoid a whole class of
 * bug:
 *
 * 1. **WhatsApp via `https://wa.me/`, never `whatsapp://`.** The https link is
 *    a universal/app link: it opens the app when installed and falls back to a
 *    web page otherwise, so graceful degradation is free. It also needs no iOS
 *    `LSApplicationQueriesSchemes` entry and no Android `<queries>` block,
 *    both of which the custom scheme would require via a config plugin.
 *
 * 2. **Never gate on `canOpenURL`.** The platforms disagree in the worst
 *    possible way: for an undeclared custom scheme iOS *throws* while Android
 *    silently returns false even when the app is installed. So we attempt the
 *    launch and interpret the failure instead.
 *
 * Launching never completes a reminder (docs/DOMAIN.md §9). This interface
 * returns no signal about whether contact happened, because no such signal
 * exists — we cannot know if a call connected or a message was sent.
 */
import { Linking } from 'react-native';
import type {
  CommunicationLauncher,
  LaunchResult,
} from '../../ports/CommunicationLauncher';
import { isE164, toWaMeDigits } from '../../domain/contact/phone';

export class LinkingCommunicationLauncher implements CommunicationLauncher {
  async call(e164: string): Promise<LaunchResult> {
    if (!isE164(e164)) {
      return { outcome: 'invalid-number', detail: 'Number is not in E.164 form.' };
    }

    // ACTION_VIEW on Android lands in the dialer with the number prefilled, and
    // iOS shows a confirmation. The user always presses call themselves, which
    // is both correct for the product and why no CALL_PHONE permission is
    // needed (docs/PLATFORM.md §5.1).
    return this.open(`tel:${e164}`);
  }

  async whatsApp(e164: string): Promise<LaunchResult> {
    if (!isE164(e164)) {
      return { outcome: 'invalid-number', detail: 'Number is not in E.164 form.' };
    }

    const digits = toWaMeDigits(e164);
    if (digits.length === 0) {
      return { outcome: 'invalid-number', detail: 'No digits to dial.' };
    }

    // Note: if the number is not registered on WhatsApp, WhatsApp itself shows
    // an invalid-number surface and openURL still resolves. That is
    // undetectable programmatically, so we do not pretend otherwise.
    return this.open(`https://wa.me/${digits}`);
  }

  private async open(url: string): Promise<LaunchResult> {
    try {
      await Linking.openURL(url);
      return { outcome: 'launched' };
    } catch (error) {
      // On iOS a cancelled confirmation dialog rejects identically to a hard
      // failure, so this genuinely cannot be disambiguated. The port names that
      // ambiguity rather than guessing — callers must not show an error for it.
      return {
        outcome: 'cancelled-or-failed',
        detail: error instanceof Error ? error.message : 'Could not open the link.',
      };
    }
  }
}
