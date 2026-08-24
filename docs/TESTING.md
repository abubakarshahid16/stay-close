# Testing

> **Issues:** `050` (#61), `051` (#62), `052` (#63), `053` (#64), `056` (#67)
> **Current state:** 549 tests across 22 suites, all passing. No native build required.

---

## 1. Running the tests

```bash
npm test              # domain, application and simulation suites
npm run test:adapters  # persistence and platform adapter suites
npm run test:all       # everything
npm run typecheck      # tsc --noEmit
npm run lint           # eslint, including the architecture rules
```

**Node 24 or newer is required.** The persistence suite uses the built-in
`node:sqlite`, unflagged from Node 23.4.

Nothing here needs a native toolchain, an emulator, or a device. That is deliberate — see §4.

---

## 2. The two Jest projects

| Project | Contents | Requirements |
|---|---|---|
| `unit` | `__tests__/domain`, `__tests__/app`, `__tests__/simulation` | none |
| `adapters` | `__tests__/adapters` | `node:sqlite` (built in) |

The split exists so the suites that matter most run everywhere. An earlier version used
`better-sqlite3`, whose native build aborted the entire dependency install on a Windows machine
without MSVC — leaving no TypeScript, Jest or ESLint at all. Replacing it with a `SqlDriver` port
and `node:sqlite` removed that class of failure, and lets migrations be verified through the same
code path production uses.

---

## 3. What is tested where

| Area | Suite | Notes |
|---|---|---|
| Clock and Random ports | `domain/ports.test.ts` | Includes a 2000-seed distribution check — a biased shuffle would silently break rotation fairness |
| E.164 normalisation | `domain/phone.test.ts` | The durable identity key; a bug means duplicate people or a dead WhatsApp link |
| Local wall-clock and DST | `domain/timezone.test.ts` | Skipped and repeated local times, month clamping, leap years |
| Cadence evaluation | `domain/cadence.test.ts` | All four worked examples from `docs/DOMAIN.md` §4 asserted directly |
| Eligibility and rotation | `domain/rotation.test.ts` | The priority ladder, tier by tier |
| Reminder state machine | `domain/reminderStateMachine.test.ts` | All 5 states × 5 actions, exhaustively |
| Derived metrics | `domain/metrics.test.ts` | Including the judgement calls — see §5 |
| **Rotation fairness** | `simulation/fairness.test.ts` | 28 long-horizon simulations. The most important suite in the repo — §6 |
| Groups and membership | `app/GroupUseCases.test.ts` | Cancel-then-delete ordering, cross-group isolation |
| Contact sync | `app/SyncContactReferences.test.ts` | Identifier churn, deletion, permission loss |
| Scheduler | `app/RunScheduler.test.ts` | Idempotence, catch-up, schedule editing |
| Reminder resolution | `app/ReminderUseCases.test.ts` | What each resolution does *not* record |
| Notification reconciliation | `app/ReconcileNotifications.test.ts` | Drift repair, the iOS 64-notification budget |
| History and metrics | `app/HistoryQueries.test.ts` | Consistency across destructive edits |
| Startup | `app/StartupReconciliation.test.ts` | Step isolation, non-destructive recovery |
| Normative edge cases | `app/edgeCases.test.ts` | The 19-row table in `docs/DOMAIN.md` §16, with a coverage map |
| **End-to-end workflow** | `app/endToEnd.test.ts` | The whole pipeline from `docs/PRODUCT.md` §3 — §7 |
| Schema and migrations | `adapters/migrations.test.ts` | History-preservation constraints |
| Repositories | `adapters/repositories.test.ts` | Global (not group-scoped) pending and recency |
| Communication launchers | `adapters/LinkingCommunicationLauncher.test.ts` | `canOpenURL` is never called |
| Permission allowlist | `adapters/withMinimalPermissions.test.ts` | An unanticipated permission is stripped |
| **Network independence** | `adapters/networkIndependence.test.ts` | Enforces the no-network promise — §8 |

---

## 4. What the automated suite cannot cover

Being explicit about this matters more than the coverage number.

The suite proves the *logic that consumes* platform behaviour, using fakes. It cannot prove the
platform's side of the contract. Specifically it cannot test:

- notification delivery with the app force-quit
- reboot survival of pending notifications
- the iOS 64-notification cap being applied
- OEM battery managers on Android
- iOS 18 limited contact access
- identifier churn across a real iCloud or Google sync
- `tel:` and `wa.me` behaviour (the iOS Simulator cannot place calls)
- whether Hermes on Android honours a named `Intl` timezone

All of these are specified as runnable procedures in `docs/DEVICE_VERIFICATION.md`, with pass
criteria and what each failure would mean for the design. **They have not been run** — this
machine has no devices and no iOS toolchain.

A green suite here therefore means "the logic is correct", not "the app works on a phone".

---

## 5. Tests that pin down judgement, not arithmetic

Some assertions exist to stop a later change quietly reversing a decision:

- **Cancellations do not count against the user.** Excluded from the completion-rate denominator
  and ignored by streaks: a cancellation is the app withdrawing its own request, not the user
  declining (`docs/DOMAIN.md` §8.4).
- **`null` is not `0`.** `completionRate` returns null when nothing is resolved, because showing
  a new user 0% would be false.
- **Only completion writes contact history.** Skip, snooze, deprioritize and cancel each have a
  test asserting `lastContactedAt` stays null. Without that, rotation weighting would drift
  invisibly.
- **A one-person group repeats every cycle.** Asserted explicitly so it is not mistaken for the
  repetition pathology §7 forbids, and not "fixed" later.
- **Notifications never name the person.** A lock screen is visible to anyone holding the phone.

---

## 6. The fairness simulations

`docs/DOMAIN.md` §7 forbids naive random selection because it produces
`Ahmed · Ahmed · Ahmed · Sara · Ahmed`. That is a property of behaviour over many cycles, which
no case-by-case test can detect.

The 28 simulations run the real selection code over long horizons and assert:

- nobody is picked in consecutive cycles while others wait — across 2, 3, 5, 10, 30 and
  100-person groups, and 25 different seeds
- selections stay within 1 of perfectly even over 120 cycles
- never-contacted people are exhausted before anyone is revisited
- an unresolved reminder blocks reselection globally
- a skip defers but does not exclude; deprioritization excludes while others exist yet stays
  reachable when nobody else is
- two groups sharing members never double-remind in the same round

Every run is seeded and clock-driven, so results are reproducible and never flaky.

---

## 7. The end-to-end test

`app/endToEnd.test.ts` walks the entire pipeline through the real use cases, the real SQL layer,
the real rotation engine and the real reconciliation — only the platform edges are faked.

The per-unit suites prove each piece in isolation; this proves they **compose**. A person selected
by rotation is the person a reminder is raised for, whose completion writes history that changes
what the next cycle selects. That chain is where integration bugs live.

It also covers realistic disruption: two months of the app never being opened, a contact deleted
from the phone, notifications denied, contacts permission revoked mid-life, an app restart, and
two groups sharing a person.

---

## 8. The network-independence guard

`adapters/networkIndependence.test.ts` scans `src/`, `app/` and `plugins/` on every CI run for
network APIs and outbound hosts. It is a **source scan, not a runtime interception**: a runtime
test only catches paths it happens to execute, whereas the promise in `docs/PRODUCT.md` §4 is
about the presence of a network call *anywhere*.

The guard also guards itself — it asserts it scanned a non-trivial number of files, that a
planted `fetch(` **is** detected, and that a comment mentioning `fetch` is **not**.

---

## 9. Conventions

- **No test depends on the real clock.** `FakeClock` everywhere; `Date.now()` is lint-banned
  outside adapters.
- **No test depends on unseeded randomness.** `SeededRandom` everywhere.
- **Fakes, not mocks, for ports.** `FakeClock`, `FakeContactProvider`,
  `FakeNotificationScheduler`, `NodeSqlDriver` — real implementations of the port contract, so
  they exercise the same code paths production does.
- **Application tests run against real SQL.** Deliberately: the behaviours under test
  (cascade vs SET NULL, unique constraints) are expressed in the schema, so a fake repository
  would pass tests the real database fails.
- **Comments say why, not what.** A test whose reason is not obvious carries a one-line
  explanation or a spec reference.
