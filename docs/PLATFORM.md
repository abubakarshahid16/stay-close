# Platform Capabilities and Limits

> **Issue:** `003 [Architecture] Investigate Expo Contacts, notifications, and platform limits` (#14)
> **Verified against:** expo ~57.0.13 · expo-contacts ~57.0.4 · expo-notifications ~57.0.11 ·
> expo-sqlite ~57.0.1 · react-native 0.86.2
> **Method:** installed type definitions and native sources in `node_modules` are treated as
> authoritative; official docs used for behaviour types cannot express. Disagreements are flagged.

Confidence is marked per finding: **[verified]** from installed source/types ·
**[docs]** from official documentation · **[known]** established platform behaviour, no primary
source captured · **[uncertain]** needs device verification.

---

## 1. expo-contacts

### 1.1 API surface — SDK 57 changed the default

**[verified]** SDK 57's package root exports a **class-based** API. The function-based API used
by the old Circles code now lives at `expo-contacts/legacy`.

| Legacy | SDK 57 default |
|---|---|
| `getContactsAsync(query)` | `Contact.getAll(options)` / `Contact.getAllDetails(fields, options)` |
| `getContactByIdAsync(id)` | `new Contact(id)` then `.getDetails(fields)` |
| `presentContactPickerAsync()` | `Contact.presentPicker()` |

**Decision:** use the new class API. Wrap it behind our own `ContactProvider` port
(issue `009`) so the domain never imports `expo-contacts` directly.

### 1.2 Permission model — `granted` does **not** mean full access

**[verified]** from `build/types/Permissions.d.ts` and `ios/ContactsRequester.swift`:

```ts
export type ContactsPermissionResponse = PermissionResponse & {
  accessPrivileges?: 'all' | 'limited' | 'none';
};
```

Native mapping on iOS:

| `CNAuthorizationStatus` | `status` | `accessPrivileges` |
|---|---|---|
| `.authorized` | `granted` | `'all'` |
| `.limited` (iOS 18+) | **`granted`** | `'limited'` |
| `.denied` | `denied` | `'none'` |
| `.restricted` | **`denied`** | `'none'` |
| `.notDetermined` | `undetermined` | `'none'` |

Three consequences that must shape our code:

1. **Checking `status === 'granted'` is insufficient.** Limited access reports `granted` while
   returning only a user-selected subset of contacts — silently, with no error. This is the most
   likely latent bug in any contacts app.
2. **iOS `restricted` is indistinguishable from `denied`** — there is no separate status value.
   Infer a terminal state from `canAskAgain === false`.
3. **`accessPrivileges` is iOS-only.** Android's permissions delegate never sets it, so it is
   `undefined` there. Never branch on it cross-platform without a Platform guard.

**Decision:** our `ContactPermissionResult` port models `granted | limited | denied | restricted |
undetermined | unavailable` as distinct domain states, mapping `granted + limited` →
`limited`. `docs/DOMAIN.md` §2.1 is updated accordingly.

### 1.3 Contact identifiers are **not** durably stable — architectural impact

**[verified]** JSDoc in `build/types/Contact.d.ts`: iOS returns a UUID string; Android returns
the `_ID` column from `ContactsContract.Contacts`.

**[docs]** Android's Contacts Provider guide states plainly:

> "Because the Contacts Provider maintains contacts automatically, it may change a contact row's
> `_ID` value in response to an aggregation or sync."

The documented stable alternative is `LOOKUP_KEY`. **[verified]** expo-contacts does **not**
expose it to JS — `LOOKUP_KEY` exists in `android/.../Columns.kt` and an internal
`getLookupKey()` in `ContactRepository.kt`, but no JS type surfaces it.

**[known]** On iOS, `CNContact.identifier` carries no stability guarantee: it is device-local
(different on iPhone vs iPad for the same person), is not preserved across backup/restore, and
can be reassigned when CardDAV/Google-backed contacts sync.

ID churn events: contact merge/aggregation, account sync, device migration, restore from backup.
Not churn events: editing a contact, device reboot, app reinstall on Android.

**Decision — this changes the domain model.** A `ContactReference` must **not** treat the native
identifier as its durable primary key. It stores:

- `nativeId` — fast-path lookup, may change
- `phoneE164` — normalised number, our durable identity anchor
- `displayNameCache` — fallback label and secondary match signal

Resolution order: try `nativeId`; on miss, re-resolve by `phoneE164`; on match, **repair**
`nativeId` in place; on failure, mark `unavailable`. This makes ID churn a self-healing
condition rather than data loss. Feeds issues `011` and `012`.

### 1.4 Contact-not-found behaviour differs by API

**[verified]** Legacy `getContactByIdAsync` returns `undefined` and does not throw. The new
class API **throws** — `ContactNotFoundException` on both platforms, raised on first read
(`getDetails()`), not at construction.

**Decision:** the port wraps `getDetails()` in try/catch and returns a nullable result, so a
deleted or merged contact becomes `unavailable`, never an unhandled rejection.

### 1.5 Expo Go and config

**[docs]** expo-contacts works in Expo Go in SDK 57. The single exception is the iOS `note`
field, which needs the `ios.accessesContactNotes` entitlement and a development build. We do
not use `note`.

**[verified]** `plugin/src/withContacts.ts` always adds **both** `READ_CONTACTS` **and**
`WRITE_CONTACTS` on Android.

**Decision:** we only read. `WRITE_CONTACTS` is a Play Store sensitive permission and violates
our minimum-permission rule (`docs/PRODUCT.md` §5), so a config plugin must **strip** it. Filed
as work under issue `010`; verified by the permission audit (`048`).

### 1.6 Bulk reads

**[verified]** `Contact.getAllDetails(fields, options)` is documented as the optimised bulk path —
it avoids constructing full `Contact` instances. `ContactQueryOptions` supports
`{ limit, offset, sortOrder, name }`.

**Decision:** always pass an explicit narrow field list (name + phone numbers only). There is a
history of iOS `CNPropertyNotFetchedException` crashes when fetching all fields.

---

## 2. expo-notifications (local only)

No push, no FCM, no APNs, no server. Remote push is out of scope permanently.

### 2.1 Trigger types — corrected against installed types

**[verified]** from `build/Notifications.types.d.ts` lines 240–248:

```ts
export declare enum SchedulableTriggerInputTypes {
  CALENDAR = "calendar",  DAILY = "daily",     WEEKLY = "weekly",
  MONTHLY = "monthly",    YEARLY = "yearly",   DATE = "date",
  TIME_INTERVAL = "timeInterval"
}
```

Platform support, taken from `@platform` annotations in the same file:

| Trigger | Fields | Platform |
|---|---|---|
| `DATE` | `date` | both |
| `TIME_INTERVAL` | `seconds`, `repeats` | both |
| `DAILY` | `hour`, `minute` | both |
| `WEEKLY` | `hour`, `minute`, `weekday` | both |
| `MONTHLY` | `day`, `hour`, `minute` | both |
| `YEARLY` | `day`, `month`, `hour`, `minute` | both |
| `CALENDAR` | `day`/`hour`/`minute`/`month`/`year`/`weekday`, `repeats` | **iOS only** |

> **Documentation disagreement — resolved.** The SDK 57 web docs summary states DAILY, WEEKLY,
> MONTHLY and YEARLY are *Android only*. The installed type definitions carry **no** `@platform`
> annotation on any of them, while `CalendarTriggerInput` is explicitly `@platform ios`. The
> types are authoritative. Treat the four recurring triggers as cross-platform, and treat
> `CALENDAR` as the iOS-only one.

**Decision:** use **`DATE` triggers exclusively**, one per reminder occurrence. We never use
repeating triggers. Rationale: our reminder set is computed by the rotation engine per cycle and
is not a fixed calendar repetition — *who* to remind about changes every cycle, so a repeating
OS trigger cannot express it. One `DATE` trigger per `ReminderInstance` also keeps
notification identity 1:1 with a database row, which is what makes reconciliation and
idempotence (§`031`) tractable.

### 2.2 Reboot survival

**[docs]** Android: scheduled notifications survive reboot, and the module documents *"this
module requires permission to subscribe to the device boot. It's used to set up scheduled
notifications when the device (re)starts"* — i.e. `RECEIVE_BOOT_COMPLETED`.

**[uncertain]** iOS reboot survival for pending `UNNotificationRequest`s is not documented in
the SDK 57 page. **[known]** iOS generally does preserve pending local notification requests
across reboot, as they are held by the system notification centre rather than the app.

**Decision:** do not trust either platform. Startup reconciliation (§`043`) re-derives the
required notification set from the database and repairs any drift. This makes reboot behaviour a
non-issue by construction rather than by platform faith.

### 2.3 Pending-notification limits

**[known]** iOS caps pending local notification requests at **64** per app; requests beyond the
cap are silently dropped. **[uncertain]** — not stated in the SDK 57 docs or the installed types;
requires device verification.

**Decision:** treat 64 as a hard budget. The notification scheduler only ever materialises
notifications for the **near horizon** (pending + next cycle), never the full future schedule.
Combined with reconciliation on launch, this keeps us far below the cap regardless of how many
Groups and Schedules the user creates. This is a real design constraint, not a theoretical one:
a naive "schedule everything forever" implementation would break silently at 64.

### 2.4 Android permissions and exact timing

**[docs]** Android 13+ (API 33) requires runtime `POST_NOTIFICATIONS`, prompted by the user.
Android 12+ (API 31) requires `SCHEDULE_EXACT_ALARM` in the manifest for exactly-timed delivery.

**Decision:** request `POST_NOTIFICATIONS` at the point of first value, not on cold launch.
Reminder delivery is **not** safety-critical, so we do **not** request `SCHEDULE_EXACT_ALARM` —
it is a restricted permission that invites Play Store scrutiny and conflicts with our
minimum-permission rule. Inexact delivery (a reminder arriving some minutes late) is entirely
acceptable for this product. `RECEIVE_BOOT_COMPLETED` is retained.

### 2.5 Expo Go

**[docs]** *"Local notifications (in-app notifications) remain available in Expo Go."* Only
remote push requires a development build.

**Decision:** Phase A is developable and testable in Expo Go. A development build is needed only
for the config-plugin work in §1.5 and §5.2, and for final device validation (`054`).

### 2.6 Degradation

If notification permission is denied or later revoked, the app stays **fully functional** — every
reminder remains a persistent in-app task (`docs/DOMAIN.md` §8.3). Notifications are an
enhancement, never the system of record.

---

## 3. expo-sqlite

**[verified]** by the existing working code in this repo plus installed types. Async surface:
`openDatabaseAsync`, `execAsync`, `runAsync`, `getFirstAsync`, `getAllAsync`,
`withTransactionAsync`, `closeAsync`.

- Fully local, no network. **[verified]** — satisfies `docs/PRODUCT.md` §4.
- `PRAGMA user_version` works and is the migration version anchor.
- `PRAGMA foreign_keys = ON` must be set **per connection**; it is not persistent.
- `withTransactionAsync` provides atomic multi-statement application.

**Decision:** keep the `user_version` migration-runner pattern (it is sound and already proven
here). Migrations are forward-only, numbered, and each runs inside a transaction. See issues
`006`, `007`.

**Note:** `better-sqlite3` is used only as a **test** adapter for running repository tests on
Node. It requires a native build toolchain (MSVC on Windows) that is not present on every
machine. This must not become a hard requirement for running the unit test suite — see
`docs/TESTING.md` and issue `005`.

---

## 3.1 Intl timezone support (Hermes) — an open risk

All local wall-clock arithmetic (`src/domain/schedule/timezone.ts`) is built on
`Intl.DateTimeFormat` with an explicit `timeZone` option. This avoids bundling a tz database
that would go stale, and it is correct in Node.

**[uncertain]** Hermes has historically shipped with trimmed ICU on Android, where
`Intl.DateTimeFormat` with a named `timeZone` could silently fall back to the device zone or
throw. React Native 0.76+ generally enables full ICU, but this is **not verified on a device**
for RN 0.86.

Why it matters: a silent fallback would not crash. It would compute cycle times in the wrong
zone, which surfaces as reminders firing at the wrong hour — plausible-looking and easy to
miss.

**Decision:** treat this as a launch blocker to verify, not an assumption. The check is cheap:

```ts
new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Karachi', hour: '2-digit' })
  .format(new Date('2026-08-16T21:00:00Z'));  // must be "02" (UTC+5), not the device hour
```

If Android turns out to lack it, the fallback is `expo-localization` for the device zone plus a
minimal offset table for the zones we can support — a meaningful scope reduction, which is
exactly why it needs verifying early. Added to §6.

---

## 4. Background execution — the constraint that shapes the architecture

**This is the most important finding in this document.**

**[known]** Neither platform offers reliable, timely background execution for an app that is
closed:

- **iOS** gives no guaranteed periodic background execution. `BGTaskScheduler` opportunistic
  windows are chosen by the system and may not fire for hours or days, or at all if the user
  force-quits the app.
- **Android** can use `WorkManager` (via `expo-background-task`) with a **15-minute minimum**
  interval, further constrained by Doze, App Standby buckets, and aggressive OEM battery
  managers that vary by manufacturer.

**Decision — the scheduler must not depend on background execution at all.**

The architecture is **pre-schedule plus reconcile**:

```text
App is open  →  scheduler runs
             →  computes due cycles up to a near-future horizon
             →  creates ReminderInstance rows (idempotently)
             →  registers one DATE notification per pending reminder

App is closed →  the OS delivers already-registered notifications
              →  no app code runs, and none needs to

App reopens  →  startup reconciliation:
                 generate any cycles that came due while closed
                 recover pending and overdue reminders
                 re-derive the required notification set and repair drift
```

Consequences, all deliberate:

1. Reminder *generation* happens at app open, not at the exact cycle instant. Notifications for
   already-known reminders still fire on time via the OS.
2. If the user does not open the app for weeks, cycles that came due are generated on next
   launch and correctly classified as overdue. Nothing is lost — this is exactly why
   `ReminderInstance` is persistent (`docs/DOMAIN.md` §8.3).
3. Reconciliation must be idempotent, because it runs on **every** launch (`031`, `043`).
4. No `expo-background-task` / `expo-task-manager` dependency is added in V1. Fewer moving
   parts, fewer permissions, no OEM-specific failure modes.

---

## 5. Deep links — Phone and WhatsApp

### 5.1 `tel:`

**[docs]** iOS 10.3+ shows a system confirmation alert before dialling. `*` and `#` are not
supported in `tel:` URLs — percent-escape user-supplied numbers. The iOS **Simulator cannot
place calls**, so this needs device testing.

**[verified]** React Native's `openURL` issues `Intent(ACTION_VIEW, uri)`, not `ACTION_CALL`.
The dialer handles `tel:` under `ACTION_VIEW`, so the number is pre-filled and the user must
press call.

**Decision:** never add `CALL_PHONE`. It is only needed for `ACTION_CALL` (placing a call with
no user action), is a Play Store sensitive permission, and would violate §5 of `PRODUCT.md`.
Requiring the user to press call is also correct for this product — §9 of `DOMAIN.md` forbids
inferring that contact happened.

### 5.2 WhatsApp — use `https://wa.me/`, not `whatsapp://`

**Decision:** use `https://wa.me/<e164-digits>` and never the custom scheme. Reasons:

- It is a universal/app link: opens the app when installed, falls back to a web page otherwise.
  Graceful degradation comes free.
- It needs **no** iOS `LSApplicationQueriesSchemes` entry and **no** Android `<queries>` entry,
  because `https` is already covered. **[verified]** the Expo bare template's manifest ships an
  `https` `<queries>` block and nothing else — so `whatsapp://` would additionally require a
  custom config plugin, while `wa.me` works out of the box.

**Number formatting is strict.** Full international format, country code required, `+` and all
spaces, dashes and brackets stripped, and any leading trunk zero removed:

```text
+1 (555) 123-4567   →  15551234567
UK 07700 900123     →  447700900123      (drop leading 0, prepend 44)
```

Malformed numbers are the primary cause of failure here, which is a second reason to store
`phoneE164` on `ContactReference` (§1.3) rather than a raw display string.

**[docs/known]** If the number is not registered on WhatsApp, WhatsApp itself shows an
invalid-number surface. The `openURL` promise **resolves either way**, so we cannot detect an
unregistered number programmatically. Do not attempt to.

### 5.3 `canOpenURL` is a trap

**[verified]** from `RCTLinkingManager.mm` and `IntentModule.kt` — the platforms behave
asymmetrically:

| | `canOpenURL` with an undeclared custom scheme |
|---|---|
| iOS | **Rejects** (throws) with *"Add %@ to LSApplicationQueriesSchemes in your Info.plist"* |
| Android | Resolves **`false`** — silently, even when the app is installed |

So `await Linking.canOpenURL('whatsapp://')` throws on iOS and lies on Android.

**Decision:** do not gate actions on `canOpenURL`. Call `openURL` inside try/catch and handle
rejection. Note also that on iOS a user **cancelling** the `tel:` confirmation dialog rejects
identically to a hard failure — so never show an error toast on `tel:` rejection without
accounting for cancellation. Feeds issues `038`, `039`.

---

## 6. Open questions requiring physical-device verification

These cannot be settled on this machine (Windows, no devices, no iOS toolchain). Each is
tracked by an existing issue.

| # | Question | Issue |
|---|---|---|
| 1 | Is the iOS pending-notification cap exactly 64, and are excess requests dropped silently? | `037` |
| 2 | Do pending iOS local notifications survive a reboot? | `036` |
| 3 | Do notifications arrive with the app force-quit on iOS, and on Android across OEM battery managers? | `037` |
| 4 | Does inexact Android delivery (no `SCHEDULE_EXACT_ALARM`) drift acceptably? | `037` |
| 5 | Does iOS 18 limited-contact access behave as §1.2 describes, and does `ContactAccessButton` grant incrementally? | `010` |
| 6 | How much does `nativeId` actually churn across an iCloud/Google sync and a restore? | `012` |
| 7 | Does `tel:` behave as described on a real iPhone and a real Android handset? | `038` |
| 8 | Does `wa.me` open the installed app rather than the browser on both platforms? | `039` |
| 9 | **Does `Intl.DateTimeFormat` honour a named `timeZone` under Hermes on Android?** A silent fallback would compute every cycle time in the wrong zone without crashing. See §3.1. | `033` |

---

## 7. Summary of binding decisions

1. Use the SDK 57 class-based contacts API, behind our own port.
2. Model `limited` contact access as a first-class state — `granted` is not enough.
3. `ContactReference` anchors durable identity on **normalised E.164**, with `nativeId` as a
   repairable fast path.
4. Strip `WRITE_CONTACTS`; never request `CALL_PHONE` or `SCHEDULE_EXACT_ALARM`.
5. Use `DATE` notification triggers only — one per reminder, never repeating triggers.
6. Budget against a 64 pending-notification cap; materialise only a near horizon.
7. **No background execution.** Pre-schedule notifications, reconcile idempotently on launch.
8. Use `https://wa.me/` for WhatsApp; never gate on `canOpenURL`.
9. Trust nothing about reboot behaviour — reconciliation repairs drift by construction.
