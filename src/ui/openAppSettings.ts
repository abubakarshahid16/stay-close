/**
 * Opens this app's entry in the OS settings.
 *
 * Needed because a permission can reach a state the app cannot recover from on
 * its own. Android stops showing the system prompt after the user has declined
 * twice — `canAskAgain` goes false — and from then on requesting again is a
 * silent no-op. Telling someone to "change it in Settings" and leaving them to
 * find it is the difference between a recoverable state and a dead end, and
 * this app had the dead end: contacts and notifications could both get stuck
 * with nothing in the UI that could move them.
 *
 * Lives in the presentation layer rather than behind a port because it is a
 * navigation action with no domain meaning, and screens are allowed to reach
 * expo-linking (see .eslintrc.js — only persistence is restricted). Kept in one
 * place so the web case is handled once rather than in each screen.
 */
import { Platform } from 'react-native';
import * as Linking from 'expo-linking';

/** True where an OS settings screen exists to open at all. */
export const canOpenAppSettings = Platform.OS !== 'web';

/**
 * @returns true if the settings screen was opened, false if it could not be.
 *   Never throws: a screen calling this is already handling a degraded state,
 *   and an exception here would replace a useful message with a crash.
 */
export async function openAppSettings(): Promise<boolean> {
  if (!canOpenAppSettings) return false;
  try {
    await Linking.openSettings();
    return true;
  } catch {
    return false;
  }
}
