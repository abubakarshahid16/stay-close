# Changelog

All notable changes to Stay Close are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased] — Functional V1 rebuild

A **ground-up rebuild**, not an increment. The earlier "Circles" product has been removed and
replaced with a different design; `docs/PRODUCT.md` §8 lists every deliberate difference so the
old behaviour is not partially revived.

> **Note on the previous `[Unreleased]` section.** It described work as complete that was not:
> it claimed CI ran ESLint and the db/integration suites (it ran neither), that web-safe dialogs
> had replaced `Alert.alert` (12 direct calls remained), and that Home and Circles refreshed on
> focus (only one unrelated screen did). It has been replaced with the entries below, which state
> only what is actually in the tree.

### Removed

- The entire Circles product: screens, services (`ReminderEngine`, `BackupService`,
  `ContactService`, `NotificationService`), db layer, hooks, context, and their tests
- The web/PWA target — `deploy-web.yml`, `public/`, `web/`, the PWA scripts,
  `react-native-web`, `react-dom`, and the Metro `.wasm` rule. Web is not a V1 target
- JSON backup and restore, and `expo-document-picker` / `expo-sharing`
- The "Show someone else" reminder action
- `better-sqlite3`, replaced by a `SqlDriver` port over the built-in `node:sqlite`

### Added — architecture

- Four-layer architecture with dependencies pointing strictly inward, and **six layering rules
  enforced by lint**: the domain cannot import Expo, React or adapters; screens cannot import
  repositories; `Date.now()` and `Math.random()` are banned outside adapters
- Six ports: `Clock`, `Random`, `ContactProvider`, `NotificationScheduler`,
  `CommunicationLauncher`, `SqlDriver`, plus nine repository interfaces and a `UnitOfWork`
- SQLite schema with forward-only migrations. History never cascades: reminder and contact
  records outlive the group they came from

### Added — domain

- E.164 phone normalisation, used as the durable identity anchor
- Local wall-clock arithmetic with DST handling and monthly clamping (a 31st-anchored schedule
  clamps to Feb 28 and returns to Mar 31)
- Cadence evaluation for daily, every-X-days, weekly, every-X-weeks and monthly
- **Fair randomized rotation** over a priority ladder, randomising only within equal priority
- Reminder state machine with four resolutions: complete, snooze, skip, deprioritize
- Snooze with five predefined options, measured from *now*
- Global cross-group contact history, and derived metrics computed from it rather than stored

### Added — application

- Idempotent scheduler: running it repeatedly produces one reminder per person per cycle,
  guaranteed by database constraints rather than application checks
- Catch-up generation for cycles missed while the app was closed, since no reliable background
  execution exists on either platform
- Contact sync with native-identifier repair, so an account sync does not look like every
  contact being deleted
- Notification reconciliation with a 48-notification budget under the iOS cap of 64
- Startup reconciliation with isolated steps: one failure does not abort the launch
- Non-destructive database recovery — a corrupt database surfaces a decision, never a wipe

### Added — testing and audits

- 549 tests across 22 suites, requiring no native build, emulator or device
- 28 long-horizon rotation fairness simulations
- End-to-end workflow test covering the full pipeline plus realistic disruption
- Network-independence guard that scans the source on every CI run
- Permission **allowlist** config plugin, after the audit found a transitive Expo plugin adding
  `INTERNET`, `READ_EXTERNAL_STORAGE` and `WRITE_EXTERNAL_STORAGE`
- Dependency, network and permission audits recorded in `docs/SECURITY.md`, each finding marked
  verified or unverified

### Fixed

- CI now gates for real. Previously lint never ran, the db and integration suites never ran, and
  component tests were `continue-on-error` — so a red build could look green
- The type error that had CI failing: `BackupService.ts` used `expo-file-system`'s
  `documentDirectory`, removed in v57. The file is gone rather than patched
- Restored `@react-native/jest-preset`, without which the whole unit project failed to load

### Known gaps

- **No on-device verification has been performed.** Procedures are written in
  `docs/DEVICE_VERIFICATION.md` but not run: notification delivery with the app force-quit,
  reboot survival, the iOS notification cap, iOS 18 limited contact access, and whether Hermes on
  Android honours a named `Intl` timezone. That last one is a launch blocker to check, because a
  silent fallback would compute every cycle time in the wrong zone without erroring
- Screens are placeholders. Phase A is functional only; UI work is Phase B
- No installable build, store listing or release artefact

---

## Earlier releases

`v1.0.0`, `v1.0.1` and `v1.0.2` were the previous Circles product, including an Android APK and a
GitHub Pages PWA. Both artefacts and that product design are superseded by the rebuild above.
