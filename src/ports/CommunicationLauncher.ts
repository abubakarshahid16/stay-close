/**
 * CommunicationLauncher port — launching external apps.
 *
 * `LaunchResult` is a returned value rather than a thrown error on purpose.
 * On iOS, a user *cancelling* the `tel:` confirmation dialog rejects
 * identically to a hard failure (docs/PLATFORM.md §5.3), so a thrown error
 * could not be interpreted correctly. `cancelled-or-failed` names that
 * ambiguity honestly instead of guessing.
 *
 * Launching an app NEVER completes a reminder (docs/DOMAIN.md §9). This
 * interface deliberately returns no signal about whether contact happened,
 * because no such signal exists.
 */

export type LaunchOutcome =
  | 'launched' // the OS accepted the request
  | 'no-handler' // nothing on the device can handle it
  | 'invalid-number' // we could not build a valid target
  | 'cancelled-or-failed'; // iOS cannot distinguish these two

export interface LaunchResult {
  readonly outcome: LaunchOutcome;
  /** Diagnostic detail. Never contains the phone number. */
  readonly detail?: string;
}

export interface CommunicationLauncher {
  /** Open the dialer with the number prefilled. Never places the call itself. */
  call(e164: string): Promise<LaunchResult>;

  /** Open WhatsApp via https://wa.me/. See docs/PLATFORM.md §5.2. */
  whatsApp(e164: string): Promise<LaunchResult>;
}
