# Security & Privacy Audit

> **Issues:** `047` (#58) dependency and network-independence audits, `048` (#59) permission audit,
> `049` (#60) local data protection and threat model.
> **Audited:** commit on `feat/functional-v1`, Expo SDK 57, React Native 0.86.
> **Scope:** static audit of the repository and dependency tree. The on-device half —
> airplane-mode operation and traffic inspection — is specified in
> `docs/DEVICE_VERIFICATION.md` §8 and has **not** been run.

Findings are marked **[verified]** where a command or test proves them, and
**[unverified]** where they still require a device or a release build.

---

## 1. Summary

| Audit | Result |
|---|---|
| Network calls in our source | **None** [verified — automated test] |
| HTTP client dependencies | **None** [verified] |
| Analytics / crash / attribution SDKs | **None** [verified] |
| Backend or auth clients | **None** [verified] |
| Android permissions requested | **3, each justified** [verified in config; unverified in a release build] |
| Unwanted permissions from transitive plugins | **Found and stripped** [verified] |
| Local data encrypted by the app | **No — and we do not claim otherwise** (§5) |

One real finding, in §3. Everything else came back clean.

---

## 2. Network independence — issue 047

### 2.1 Our own source

**[verified]** `__tests__/adapters/networkIndependence.test.ts` scans every file in `src/`,
`app/` and `plugins/` on each CI run for `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`,
`sendBeacon`, `axios`, `node:http`/`https`, and the Expo push-token APIs. Zero matches.

It is a **source scan, not a runtime interception**, on purpose: a runtime test only catches
paths a test happens to execute, whereas the claim being made is about the mere presence of a
network call anywhere in the app.

The test also guards itself — it asserts it scanned a non-trivial number of files (so a broken
directory walk cannot pass vacuously), asserts a planted `fetch(` *is* detected, and asserts a
comment mentioning `fetch` is *not*.

### 2.2 Outbound URLs

**[verified]** Exactly one remote URL appears anywhere in our source: `https://wa.me/`. That is
a deep link handed to the operating system, not a request this app makes — the user is leaving
Stay Close (`docs/DOMAIN.md` §12). Asserted by test; any new host fails the build.

### 2.3 Dependencies

**[verified]** Fifteen direct runtime dependencies, all `expo-*`, `react`, `react-native` or
`react-native-*`. The tree was checked for the common analytics, crash-reporting and attribution
packages (Segment, Amplitude, Mixpanel, Sentry, Bugsnag, Firebase, PostHog, AppsFlyer, Branch,
Datadog) — **none present at any depth**. Guarded by test so a future `npm install` cannot
introduce one quietly.

### 2.4 What this audit cannot establish

**[unverified]** A static audit cannot prove a *dependency* makes no request of its own. Only
on-device traffic inspection can, and that is specified in `docs/DEVICE_VERIFICATION.md` §8.

Two known non-issues, stated so they are not mistaken for findings later:

- `expo-notifications` contains push-notification code. We never call it — no push-token API
  appears in our source, and no FCM or APNs configuration exists. Local notifications require
  no network.
- Expo's CLI has its own telemetry. That is build-time tooling, not shipped app code, and it is
  disabled in CI via `EXPO_NO_TELEMETRY=1`.

---

## 3. Permission audit — issue 048

### 3.1 The finding

**[verified]** `expo-file-system` is a **transitive** dependency of `expo` itself. We never
added it and never use it. Its config plugin adds three permissions:

```
android.permission.INTERNET
android.permission.READ_EXTERNAL_STORAGE
android.permission.WRITE_EXTERNAL_STORAGE
```

Separately, `expo-contacts`' own plugin adds `WRITE_CONTACTS` unconditionally, although this app
only ever reads.

None of the four is justified. Left alone, a release build would have requested `INTERNET` for
an app that makes no network requests, plus two storage permissions and a contacts-write
permission that Play Store review treats as sensitive.

### 3.2 The fix, and why it is an allowlist

`plugins/withMinimalPermissions.js` strips every Android permission **not** explicitly
justified, and runs last in `app.json` so it sees every other plugin's output.

This replaced an earlier blocklist that stripped only `WRITE_CONTACTS`. A blocklist is the wrong
shape: it must name each unwanted permission in advance, and this finding is precisely the case
it would miss — a package we did not choose, adding permissions we did not anticipate. With an
allowlist, anything new from anywhere in the tree is removed by default and has to be argued for.

The allowlist, with the justification each entry carries in code:

| Permission | Justification |
|---|---|
| `READ_CONTACTS` | The native address book is the source of truth for who the user knows. |
| `POST_NOTIFICATIONS` | Local reminders must be deliverable when the app is closed. |
| `RECEIVE_BOOT_COMPLETED` | Re-register scheduled local notifications after a reboot. |

**[verified]** 22 tests cover this, including that an invented
`SOME_FUTURE_PERMISSION_WE_HAVE_NEVER_SEEN` is stripped — the property a blocklist could not
provide.

### 3.3 Deliberately not requested

| Permission | Why not |
|---|---|
| `INTERNET` | The app makes no network requests (§2). An app that *cannot* reach the network is a real privacy property, not a technicality. |
| `CALL_PHONE` | Only needed to place a call with no user action. We open the dialer prefilled and the user presses call, which is also required by `docs/DOMAIN.md` §9. |
| `SCHEDULE_EXACT_ALARM` | Restricted, and reminder delivery is not safety-critical. A few minutes of drift is acceptable. |
| `WRITE_CONTACTS` | We only read. Play Store treats it as sensitive. |
| `READ_/WRITE_EXTERNAL_STORAGE` | No file import or export exists in V1. |
| Location, Camera, Microphone, Photos, Bluetooth, Calendar, Accounts | No feature requires them. |

### 3.4 iOS

**[verified in config]** One usage description only: `NSContactsUsageDescription`. Notification
permission is requested at runtime with no Info.plist entry needed. `LSApplicationQueriesSchemes`
is deliberately absent — using `https://wa.me/` instead of `whatsapp://` removes the need
(`docs/PLATFORM.md` §5.2).

### 3.5 Still to verify

**[unverified]** That the strip actually applied to a real build. The test covers the plugin's
transform, not the native output. `docs/DEVICE_VERIFICATION.md` §1 has the one-line
`grep` on the generated `AndroidManifest.xml`, and treats a surviving `WRITE_CONTACTS` or
`INTERNET` as a **release blocker**.

---

## 4. What data exists, and where

All of it is local. There is no server, no account, and no sync.

| Data | Where | Notes |
|---|---|---|
| Contact references | app SQLite database | A phone number, a cached display name, and a platform id. **Not** a copy of the address book. |
| Groups, memberships, schedules | app SQLite database | User-created structure. |
| Reminder history | app SQLite database | What the app asked. |
| Contact history | app SQLite database | What the user confirmed. |
| App settings | app SQLite database | Key/value. |

The database lives in the app's private container — `Documents` on iOS, internal app storage on
Android. Nothing is written to shared or external storage.

**Notification content deliberately excludes the person's name** (`docs/PRODUCT.md` §5). A lock
screen is visible to anyone holding the phone, so naming someone there would leak exactly what
this app promises to keep on-device. Asserted by test.

---

## 5. Local data protection — issue 049, stated honestly

**The app does not encrypt its own database.** Saying otherwise would be false, and issue 049
explicitly forbids claiming encryption that does not exist.

What actually protects the data:

| Protection | Reality |
|---|---|
| OS app sandboxing | The database is in the app's private container; other apps cannot read it. |
| Full-disk encryption | iOS encrypts by default. Android has since 6.0, generally enforced from 10. This protects data **at rest on a locked device**, not from a running attacker. |
| App-level encryption | **None.** No SQLCipher, no key management. |

What that means concretely:

- A stolen, locked, up-to-date device: data is protected by platform disk encryption.
- A rooted or jailbroken device, or one with an unlocked bootloader: **the database is readable.**
- A full device backup where the platform includes app data: relationship history may be present
  in that backup.

Why not add SQLCipher: it requires a key, and with no account there is nowhere to keep one that
is both durable and not stored beside the data it protects. A key in the same sandbox adds
obfuscation, not security, while adding a native dependency and a whole class of
"database will not open" failure. The honest trade is to rely on platform protection and say so.
This is worth revisiting only if the threat model changes to include a rooted device.

---

## 6. Log hygiene

**[verified]** `no-console` is enabled as a lint rule (`warn`, allowing `warn`/`error`). The
domain error type carries only a code and a short detail string, and `DomainError.detail` is
documented as never containing a phone number or contact name.

**[unverified]** That no third-party library logs contact data in a release build. Checking this
requires a device log capture — added to the verification list.

---

## 7. Reporting a vulnerability

This is a local-only app with no server, so there is no service to attack and no user data for
us to lose — we hold none. If you find a way for contact or relationship data to leave the
device, please open an issue describing the path. That would be the most serious class of bug
this project can have.

---

## 8. Re-audit triggers

Re-run this audit when any of the following happens:

1. A new runtime dependency is added — especially a transitive one, which is how §3 arose.
2. A permission is added to `plugins/withMinimalPermissions.js`.
3. Any file-import, export, backup or sharing feature is proposed.
4. Expo SDK is upgraded, since bundled plugins change what they add.
5. Before any store submission.
