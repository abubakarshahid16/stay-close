/**
 * Foreground presentation behaviour.
 *
 * Guards a total, silent failure of the product's main feature. Nothing called
 * `setNotificationHandler`, and expo-notifications is explicit about the
 * consequence: "for the notification to be presented you have to set a
 * notification handler with setNotificationHandler". With none set, every
 * notification arriving while the app was OPEN was swallowed without a trace —
 * "Send a test reminder" appeared to do nothing at all, and a real reminder
 * firing while the app was open would have been invisible.
 *
 * The adapter itself cannot be exercised here — it needs a device — but the
 * behaviour object can be, and it is where the two mistakes worth guarding
 * live.
 */
import { FOREGROUND_BEHAVIOUR } from '../../src/adapters/notifications/ExpoNotificationScheduler';

describe('foreground notification behaviour', () => {
  it('shows a banner, or the notification is invisible while the app is open', () => {
    expect(FOREGROUND_BEHAVIOUR.shouldShowBanner).toBe(true);
  });

  it('also lands in the notification list, so it survives being missed', () => {
    expect(FOREGROUND_BEHAVIOUR.shouldShowList).toBe(true);
  });

  /**
   * The counter-intuitive one, and the reason it is asserted rather than left
   * to judgement. From the installed expo-notifications types:
   *
   *   "On Android, setting shouldPlaySound: false will result in the drop-down
   *    notification alert NOT showing, no matter what the priority is."
   *
   * A relationship nudge should be gentle, so silencing it looks like the
   * considerate choice — and it makes the notification not appear at all. How
   * insistent it is belongs to the channel, and to the user's own settings.
   */
  it('plays a sound, because Android hides silent notifications entirely', () => {
    expect(FOREGROUND_BEHAVIOUR.shouldPlaySound).toBe(true);
  });

  // docs/PRODUCT.md: the in-app list is the system of record. A badge that
  // outlives the reminder it counted is worse than no badge.
  it('sets no badge', () => {
    expect(FOREGROUND_BEHAVIOUR.shouldSetBadge).toBe(false);
  });

  it('uses the current API, not the deprecated shouldShowAlert', () => {
    // shouldShowAlert is deprecated in favour of shouldShowBanner/shouldShowList.
    // Relying on it would work today and silently stop working later.
    expect('shouldShowAlert' in FOREGROUND_BEHAVIOUR).toBe(false);
  });
});
