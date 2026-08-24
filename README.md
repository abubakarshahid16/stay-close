# Stay Close

**A private, offline relationship-maintenance assistant for iOS and Android.**

No backend. No account. No network requests. Your contacts never leave your device.

[![CI](https://github.com/abubakarshahid16/stay-close/actions/workflows/ci.yml/badge.svg)](https://github.com/abubakarshahid16/stay-close/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

---

## Install

<a href="https://github.com/abubakarshahid16/stay-close/releases/latest">
  <img src="https://img.shields.io/badge/Download%20APK-Android-brightgreen?style=for-the-badge&logo=android&logoColor=white" alt="Download the Android APK" />
</a>

&nbsp;
<a href="https://abubakarshahid16.github.io/stay-close">
  <img src="https://img.shields.io/badge/Open%20Web%20App-Any%20browser-blue?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Open the web app" />
</a>

**Android:** download the `.apk` from the [latest release](https://github.com/abubakarshahid16/stay-close/releases/latest),
open it on your phone, and allow installing from your browser once.

**Web:** open the link above in any browser. It is installable — Chrome and Edge show an
**Install** button in the address bar; on iPhone use Safari's **Share → Add to Home Screen**.

**iOS native:** not available. iPhones cannot sideload, so a native iOS build needs TestFlight or
the App Store — neither is set up. The web app is the iPhone route for now.

### Web is deliberately limited

Not a rough edge — two hard browser limitations:

| | Android app | Web |
|---|---|---|
| Pick people from your contacts | Yes | **No** — browsers have no address book, so you type people in |
| Reminders when the app is closed | Yes | **No** — browsers cannot schedule those without a server |

Groups, schedules, fair rotation, the whole reminder lifecycle and history all work on web. You
just see your due reminders when you open the page rather than being nudged. **A phone is where it
works as intended;** web is good for trying it and for using it at a desk.

<details>
<summary><strong>Read this before installing</strong></summary>

- The APK is **debug-signed** for direct install, not a store release. It is larger and slower
  than a store build.
- **No release exists yet.** The button above will 404 until a `v*.*.*` tag is pushed, which
  triggers the build workflow.
- **Not verified on real hardware.** Notification delivery with the app closed, reboot recovery
  and offline operation are specified in `docs/DEVICE_VERIFICATION.md` but have not been tested
  on a device. If reminders do not arrive when the app is closed, that is a known unverified
  area rather than a surprise.

</details>

---

## Status: Functional V1 in progress

This branch is a **ground-up rebuild**, not an update. It replaces an earlier "Circles" version
with a different product design — see `docs/PRODUCT.md` §8 for the full list of deliberate
differences.

**There is no installable build yet.** No APK, no App Store or Play Store listing, and no web
version. The previous release artefacts and the PWA are gone: web is explicitly not a V1 target
(`docs/PRODUCT.md` §7). Running it today means building it yourself (§Development below).

| | |
|---|---|
| Functional core | Complete — contacts, groups, schedules, rotation, reminders, notifications, history |
| Test suite | 549 tests, 22 suites, all passing |
| Screens | Placeholder only. Phase A is deliberately utilitarian; UI work is Phase B |
| On-device verification | **Not done** — see `docs/DEVICE_VERIFICATION.md` |

That last row is the honest gap. The logic is tested; the app has not been run on a phone.

---

## The problem

You have people who matter — family, old friends, mentors, former colleagues — and life gets
busy. Weeks pass, then months. You meant to reach out and forgot, and by the time you think of
them it feels awkward.

Stay Close decides **who to reach out to next**, fairly, and reminds you at a time you chose. It
is not where the conversation happens — you call or message however you normally would.

---

## How it works

```text
Phone contacts  →  Groups  →  A schedule per group  →  Fair rotation
                                                            ↓
              History  ←  You confirm manually  ←  A reminder
                    ↓
        feeds back into who gets chosen next
```

Four ideas do most of the work:

**Groups, not one big list.** Family, Close Friends, Colleagues — each with its own cadence. A
person can belong to several, and removing them from one leaves the others untouched.

**People-per-cycle is separate from interval.** "2 people every 7 days" selects two people each
week. It does *not* promise each individual is contacted weekly. With 30 members, someone comes
up roughly every 15 weeks.

**Fair rotation, not random.** Naive random gives you `Ahmed · Ahmed · Ahmed · Sara · Ahmed`.
Selection walks a priority ladder — never contacted, then longest-uncontacted, then
skip-penalised, then deprioritized — and randomises only *within* equal priority. 28 long-horizon
simulations assert there is no pathological repetition.

**Nothing is ever inferred.** Opening WhatsApp does not complete a reminder. Neither does opening
the dialer, or tapping a notification. The app cannot know whether a call connected, and does not
pretend to. Only your explicit confirmation counts.

---

## Privacy

Not a feature — a constraint the code is built around.

- **No network requests at all.** Enforced by a test that scans the source on every CI run, not
  merely asserted.
- **No `INTERNET` permission.** The dependency audit found a transitive Expo plugin adding it;
  a permission allowlist now strips anything not explicitly justified.
- **Three Android permissions**, each with a written justification: read contacts, post
  notifications, receive boot completed.
- **No analytics, crash reporting, attribution or telemetry** at any depth of the dependency tree.
- **No account, no login, no backend, no sync.**
- **Notifications never name the person** — a lock screen is visible to anyone holding the phone.

**What is *not* claimed:** the app does not encrypt its own database. It relies on OS sandboxing
and platform full-disk encryption. `docs/SECURITY.md` §5 explains exactly what that protects
against and what it does not, including that a rooted device can read the data.

---

## Development

Requires **Node 24+** (the test suite uses the built-in `node:sqlite`).

```bash
npm install
npm run test:all     # 549 tests, no native build or device needed
npm run typecheck
npm run lint
```

Running the app needs a development build — Expo Go cannot carry the config-plugin changes:

```bash
npx expo prebuild --clean
npx expo run:android --device
npx expo run:ios --device      # macOS only
```

Before trusting a build, check the permission strip actually applied:

```bash
grep -c "INTERNET"       android/app/src/main/AndroidManifest.xml   # must be 0
grep -c "WRITE_CONTACTS" android/app/src/main/AndroidManifest.xml   # must be 0
```

---

## Architecture

Four layers, dependencies pointing strictly inward:

```text
app/            Expo Router screens          (Phase A: basic controls only)
src/usecases/        use cases                    (orchestration, transactions)
src/domain/     pure logic                   (no I/O, no platform, no clock)
src/ports/      interfaces                   (declared by the inside)
src/adapters/   expo-sqlite, expo-contacts, expo-notifications, Linking
```

The organising principle: **the domain must be testable with no device, no database and no
clock.** Everything else follows from that — time and randomness are injected, so the scheduling
engine can be exercised at arbitrary instants with reproducible results.

Six layering rules are **enforced by lint**, not convention: the domain cannot import Expo, React
or adapters; screens cannot import repositories; `Date.now()` and `Math.random()` are banned
outside adapters. The previous version's home screen violated four of them — it ran selection,
wrote history, and queried the database on every render.

Two platform findings shaped the design more than anything else:

- **No reliable background execution exists on either platform.** So the scheduler pre-registers
  notifications and reconciles idempotently on launch, rather than waking to generate reminders.
- **Native contact identifiers are not durable.** Android rewrites `_ID` on account sync; iOS
  identifiers are device-local and lost on restore. Identity anchors on a normalised phone number
  with the platform id as a repairable fast path, so an ordinary iCloud sync does not look like
  every contact being deleted.

---

## Documentation

| Document | Contents |
|---|---|
| `docs/PRODUCT.md` | V1 spec: purpose, scope, privacy rules, phase separation |
| `docs/DOMAIN.md` | Domain rules, state machines, algorithms — the source of truth |
| `docs/ARCHITECTURE.md` | Layers, ports, enforced rules, test strategy |
| `docs/PLATFORM.md` | Verified Expo/iOS/Android capabilities and limits |
| `docs/DATABASE.md` | Schema, and why history never cascades |
| `docs/SECURITY.md` | Dependency, network and permission audits |
| `docs/TESTING.md` | What is tested, and what the suite cannot cover |
| `docs/DEVICE_VERIFICATION.md` | On-device procedures — written, **not run** |

---

## Contributing

Work is tracked as GitHub issues grouped into milestones M1–M10. Phase A is functional only:
no colours, typography, animation or visual polish until Functional V1 is complete and verified
(`docs/PRODUCT.md` §6).

- [Report a bug](https://github.com/abubakarshahid16/stay-close/issues/new?template=bug_report.yml)
- [Request a feature](https://github.com/abubakarshahid16/stay-close/issues/new?template=feature_request.yml)

## License

MIT © [abubakarshahid16](https://github.com/abubakarshahid16) — see [LICENSE](LICENSE).
