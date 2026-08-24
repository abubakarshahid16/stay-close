# Device Verification Procedures

> **Status:** these procedures are written and ready to run. They have **not been executed**.
> **Issues:** `037` (#48), `054` (#65), `055` (#66), plus the open questions in
> `docs/PLATFORM.md` §6.

Everything in this document requires a physical iPhone and a physical Android handset. None of
it can be satisfied by CI, a simulator, or the automated suite — and the parts that matter most
(notification delivery with the app force-quit, reboot survival, the iOS notification cap)
cannot be simulated at all.

This file exists so the work is specified rather than hand-waved. Each check states what to do,
what a pass looks like, and what a failure would mean for the design.

---

## 0. Why this cannot be automated

| Behaviour | Why the test suite cannot cover it |
|---|---|
| Delivery with the app force-quit | Requires the OS scheduler; no JS runs |
| Reboot survival | Requires an actual reboot |
| The 64-notification cap | An OS-internal limit, applied silently |
| OEM battery managers | Vendor-specific, device-specific |
| iOS 18 limited contact access | Requires the system permission sheet |
| Identifier churn on account sync | Requires a real iCloud/Google account sync |
| `tel:` and `wa.me` behaviour | The iOS Simulator cannot place calls |
| Hermes `Intl` timezone support | Depends on the shipped ICU build |

The automated suite covers the logic that *consumes* these behaviours, using fakes. What is
unverified is the platform's side of each contract.

---

## 1. Build prerequisites

A development build is required — Expo Go cannot carry the config-plugin changes
(`docs/PLATFORM.md` §1.5, §2.5).

```bash
npx expo prebuild --clean
npx expo run:android --device      # Android handset
npx expo run:ios --device          # iPhone, macOS only
```

**Before anything else, confirm `WRITE_CONTACTS` was stripped.** The automated test asserts the
plugin's transform, but not that the real build applied it:

```bash
grep -c "WRITE_CONTACTS" android/app/src/main/AndroidManifest.xml   # must be 0
grep -c "READ_CONTACTS"  android/app/src/main/AndroidManifest.xml   # must be 1
```

A non-zero `WRITE_CONTACTS` count is a **release blocker** — it contradicts
`docs/PRODUCT.md` §5 and invites Play Store review.

---

## 2. Hermes `Intl` timezone support — do this first

**Issue:** `033` · **Open question:** `docs/PLATFORM.md` §3.1 · **Platform:** Android especially

Do this before any scheduling test. Every cycle time depends on it, and a failure is silent
rather than loud.

Run on-device:

```ts
new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Karachi', hour: '2-digit', hourCycle: 'h23' })
  .format(new Date('2026-08-16T21:00:00Z'));
```

- **Pass:** `"02"` — Karachi is UTC+5, so 21:00 UTC is 02:00 next day.
- **Fail:** the device's local hour, or a thrown error.

**If it fails**, `src/domain/schedule/timezone.ts` is computing every cycle in the wrong zone
without any error surfacing. That is a scope decision, not a bug fix: either add
`expo-localization` plus a bounded offset table, or restrict V1 to the device timezone only.
Escalate rather than patch.

---

## 3. Notification delivery — issue `037` (#48)

The core question: does a reminder arrive when the app is not running?

For each state below, schedule a reminder ~2 minutes out, put the app in that state, and wait.

| # | App state | Device state | iOS | Android |
|---|---|---|---|---|
| 3.1 | Foreground | unlocked | ☐ | ☐ |
| 3.2 | Backgrounded | unlocked | ☐ | ☐ |
| 3.3 | Backgrounded | locked | ☐ | ☐ |
| 3.4 | **Force-quit / swiped away** | locked | ☐ | ☐ |
| 3.5 | Force-quit | Do Not Disturb on | ☐ | ☐ |
| 3.6 | Backgrounded | Battery Saver / Low Power Mode | ☐ | ☐ |

**3.4 is the one that matters.** The whole architecture assumes the OS delivers
pre-registered notifications with no app code running (`docs/PLATFORM.md` §4). If force-quit
delivery fails on Android for a given OEM, that is a known platform limitation to document, not
a code defect — but it must be *known*.

### 3.7 Notification content carries no name

Check the lock screen shows only "Stay Close" / "Someone is waiting to hear from you."

A person's name on a lock screen is a privacy regression (`docs/PRODUCT.md` §5). Asserted in
the test suite, but confirm the rendered notification too.

### 3.8 Inexact delivery drift

We deliberately do not request `SCHEDULE_EXACT_ALARM` (`docs/PLATFORM.md` §2.4). Measure actual
delivery lateness across several reminders.

- **Pass:** within a few minutes.
- **Investigate:** more than ~15 minutes, or wildly variable.

---

## 4. Reboot recovery — issue `036` (#47)

1. Schedule reminders ~10 minutes out.
2. Confirm they are pending (Settings → in-app diagnostics, or `listScheduled`).
3. **Reboot the device.**
4. Do **not** open the app. Wait for the fire time.

| Outcome | Meaning |
|---|---|
| Notifications arrive | The OS preserved them. Good, but not relied upon. |
| Nothing arrives | Expected on some platforms — reconciliation must repair it. |

5. Now open the app and confirm reconciliation re-registers everything.

**This is designed not to matter.** `ReconcileNotifications` re-derives the required set from
the database on every launch, so reboot loss self-heals. The test suite proves the repair logic
via `simulateOsWipe()`; this confirms the real platform behaviour it compensates for.

---

## 5. The iOS 64-notification cap

**Open question 1** · `docs/PLATFORM.md` §2.3 · **iOS only**

1. Create enough groups and members to want more than 64 future reminders.
2. Run the scheduler.
3. Read back `getAllScheduledNotificationsAsync().length`.

- **Expected:** at most `NOTIFICATION_BUDGET` (48), since we cap deliberately.
- **Then** temporarily raise the budget above 64 in a scratch build and confirm the OS silently
  drops the excess — this validates *why* the budget exists.

If the real cap turns out lower than 64 on some iOS version, lower `NOTIFICATION_BUDGET`.

---

## 6. Contacts behaviour

### 6.1 iOS 18 limited access — open question 5

1. On first prompt, choose **Select Contacts** and share only 2 of many.
2. Confirm the app reports `limited`, not `granted`.
3. Confirm only the shared contacts are listed.
4. Share more, and confirm previously-stored people are **not** lost.

A person becoming invisible must be marked `unavailable`, never deleted
(`docs/DOMAIN.md` §2.1). Losing data here would be the worst failure in the app.

### 6.2 Identifier churn — open question 6

1. Add people from a Google or iCloud-backed account.
2. Force an account sync, or restore the device from backup.
3. Reopen the app and run sync.

- **Pass:** contacts resolve, `repaired` count may be non-zero, `markedUnavailable` is 0.
- **Fail:** contacts marked unavailable — the phone-number fallback is not working
  (`docs/PLATFORM.md` §1.3).

### 6.3 Permission revocation

Revoke Contacts in system settings while the app is backgrounded, then reopen.

- **Pass:** no crash; history intact; groups intact; sync reports `skipped`.
- **Fail:** anything marked unavailable — that would mean concluding "deleted" from "invisible".

---

## 7. Communication actions — issues `038`, `039`

| # | Check | Pass |
|---|---|---|
| 7.1 | `tel:` opens the dialer with the number prefilled | iOS shows a confirm; Android prefills. Neither auto-dials. |
| 7.2 | `wa.me` opens WhatsApp when installed | Opens the app, not the browser |
| 7.3 | `wa.me` with WhatsApp uninstalled | Falls back to the web page; no crash |
| 7.4 | A number not registered on WhatsApp | WhatsApp shows its own error; app unaffected |
| 7.5 | Cancel the iOS `tel:` confirm dialog | No error toast — indistinguishable from failure, so we must not claim one |
| 7.6 | Return to the app after either action | Reminder is **still pending** |

**7.6 is a product requirement, not a nicety** (`docs/DOMAIN.md` §9). Launching an app must
never complete a reminder.

---

## 8. Offline operation — issue `055` (#66)

Enable airplane mode and disable Wi-Fi, then run the full workflow:

☐ Launch · ☐ Grant Contacts · ☐ Pick contacts · ☐ Create group · ☐ Configure schedule ·
☐ Scheduler selects · ☐ Reminder appears · ☐ Notification delivered · ☐ Complete a reminder ·
☐ Snooze · ☐ Skip · ☐ Deprioritize · ☐ History updates · ☐ Restart the app · ☐ State persists

**Pass:** every step works with no network.

Launching Phone or WhatsApp is exempt only in that *those apps* may want connectivity. Stay
Close itself must not.

Also confirm zero outbound traffic — see `docs/SECURITY.md` and issue `047`.

---

## 9. Full workflow on real hardware — issue `054` (#65)

Run the end-to-end flow from `docs/PRODUCT.md` §3 on both an iPhone and an Android handset:

☐ Install · ☐ Grant Contacts · ☐ Select contacts · ☐ Create group · ☐ Configure schedule ·
☐ Scheduler selects someone · ☐ Notification delivered · ☐ Open app from the notification ·
☐ Launch WhatsApp or Phone · ☐ Return · ☐ Complete manually · ☐ History updated ·
☐ Next cycle selects **someone different**

The last step is the product's actual promise. If the same person is selected repeatedly, the
rotation is not behaving as the simulations claim — capture the group size, the schedule, and
the reminder history before changing anything.

---

## 10. Recording results

Record outcomes against the issue numbers above, noting device model and OS version — several
behaviours here are OEM-specific and a bare "works" is not reusable evidence.

Any failure in §2, §3.4, or §6.1 should be treated as blocking and escalated, since each
invalidates a documented design assumption rather than revealing an ordinary bug.
