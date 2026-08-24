# Architecture

> **Issue:** `002 [Architecture] Define technical architecture` (#13)
> **Depends on:** `docs/PRODUCT.md`, `docs/DOMAIN.md`, `docs/PLATFORM.md`
> **Status:** canonical. Supersedes the previous Circles-era architecture document.

---

## 1. Goal

The scheduling and rotation engine is the heart of this product and the part most likely to
break subtly. Therefore the single organising principle is:

> **The domain must be fully testable with no device, no database, and no clock.**

Everything else in this document follows from that.

---

## 2. Layers and dependency direction

```text
┌──────────────────────────────────────────────┐
│ Presentation      app/  — Expo Router screens│  basic controls only (Phase A)
├──────────────────────────────────────────────┤
│ Application       src/app/  — use cases      │  orchestrates; owns transactions
├──────────────────────────────────────────────┤
│ Domain            src/domain/  — pure logic  │  no I/O, no imports of anything below
├──────────────────────────────────────────────┤
│ Ports             src/ports/  — interfaces   │  declared by domain/application
├──────────────────────────────────────────────┤
│ Adapters          src/adapters/  — platform  │  expo-*, SQLite, Linking
└──────────────────────────────────────────────┘
```

**Dependencies point inward and never outward.** The domain declares the interfaces it needs
(ports); adapters implement them. Composition happens once, at the app entry point.

### 2.1 Hard rules

These are enforced by lint (issue `005`) and reviewed on every PR:

| Rule | Rationale |
|---|---|
| `src/domain/**` imports nothing from `src/adapters/**`, `app/**`, `expo-*`, or `react*` | Keeps the engine pure and testable in Node |
| No SQL outside `src/adapters/persistence/**` | Repositories own persistence; nothing else knows SQLite exists |
| No `expo-notifications` / `expo-contacts` import outside `src/adapters/**` | Platform APIs are never domain concerns |
| No scheduling or rotation logic inside a React component | The engine must be testable without rendering |
| No `new Date()`, `Date.now()`, or `Math.random()` outside `src/adapters/**` | Time and randomness are injected — §4.1, §4.2 |
| Presentation reads through use cases, never a repository directly | Keeps transaction boundaries in one layer |

The old Circles code violated four of these — the home screen ran selection, wrote history, and
called the database directly on every render. That is the specific failure mode this layering
exists to prevent.

---

## 3. Directory layout

```text
app/                            Expo Router screens (Phase A: utilitarian)
  _layout.tsx                   composition root — builds container, injects adapters
  (tabs)/index.tsx              today's reminders
  (tabs)/groups.tsx             group list
  groups/[id]/...               group detail, member selection
  reminders/[id].tsx            reminder detail + resolution actions

src/
  domain/                       PURE. No I/O. 100% unit-testable.
    contact/                    ContactReference, availability, E.164 normalisation
    group/                      Group, Membership
    schedule/                   Schedule model, cadence + occurrence maths
    rotation/                   eligibility, priority ladder, fair selection
    reminder/                   ReminderInstance, state machine, transitions
    history/                    ContactEvent, recency derivation
    metrics/                    derived scorecard calculations
    shared/                     Result type, domain errors, branded ids

  app/                          Application layer — use cases
    scheduler/                  RunScheduler, ReconcileOnStartup
    reminders/                  CompleteReminder, SnoozeReminder, SkipReminder,
                                DeprioritizeReminder
    groups/                     CreateGroup, EditGroup, DeleteGroup, membership ops
    contacts/                   SyncContactReferences
    notifications/              ReconcileNotifications

  ports/                        Interfaces the inner layers depend on
    Clock.ts  Random.ts  ContactProvider.ts  NotificationScheduler.ts
    CommunicationLauncher.ts  UnitOfWork.ts  repositories/*.ts

  adapters/
    persistence/                expo-sqlite: migrations, repositories, UnitOfWork
    contacts/                   expo-contacts (SDK 57 class API)
    notifications/              expo-notifications (DATE triggers only)
    communication/              Linking: tel:, https://wa.me/
    system/                     SystemClock, CryptoRandom

  container.ts                  dependency wiring (production)

__tests__/
  domain/                       pure unit tests — fake clock, seeded random
  app/                          use-case tests — in-memory repositories
  adapters/                     integration tests — real SQLite
  simulation/                   long-horizon rotation fairness simulations
```

---

## 4. The ports

Each port exists because a specific platform reality would otherwise leak into the domain.
`docs/PLATFORM.md` justifies each one.

### 4.1 `Clock`

```ts
interface Clock {
  now(): Instant;                       // absolute UTC
  timeZone(): TimeZoneId;               // device local zone
}
```

Why: cycle times are local wall-clock while stored instants are UTC (`DOMAIN.md` §13). DST,
timezone changes, and month-boundary clamping are all domain logic that must be testable at
arbitrary instants. Tests use `FakeClock`; production uses `SystemClock`.

**No domain or application code may read the system clock directly.**

### 4.2 `Random`

```ts
interface Random {
  int(maxExclusive: number): number;
  shuffle<T>(items: readonly T[]): T[];
}
```

Why: rotation randomises *within* a priority tier (`DOMAIN.md` §7.1). Fairness must be asserted
deterministically, so tests inject a seeded PRNG (mulberry32) and production injects an
unseeded one. This is what keeps the fairness suite from being flaky.

### 4.3 `ContactProvider`

```ts
interface ContactProvider {
  permission(): Promise<ContactPermission>;   // granted|limited|denied|restricted|undetermined|unavailable
  request(): Promise<ContactPermission>;
  resolve(nativeId: NativeContactId): Promise<ResolvedContact | null>;
  findByPhone(e164: string): Promise<ResolvedContact | null>;   // identifier-churn repair
  list(options): Promise<ResolvedContact[]>;
}
```

Why: `limited` access must be a first-class state, and `findByPhone` exists specifically to
repair native-identifier churn (`PLATFORM.md` §1.3, `DOMAIN.md` §1.1). Never throws for a
missing contact — returns `null`.

### 4.4 `NotificationScheduler`

```ts
interface NotificationScheduler {
  permission(): Promise<NotificationPermission>;
  request(): Promise<NotificationPermission>;
  scheduleAt(id: ReminderId, at: Instant, content: NotificationContent): Promise<void>;
  cancel(id: ReminderId): Promise<void>;
  listScheduled(): Promise<ReminderId[]>;     // required for reconciliation
}
```

Why: `listScheduled` is not a convenience — it is how reconciliation detects drift between the
database and the OS (`PLATFORM.md` §2.2). The identity is the `ReminderId`, giving a 1:1
mapping between a database row and an OS notification, which is what makes idempotence
checkable.

### 4.5 `CommunicationLauncher`

```ts
interface CommunicationLauncher {
  call(e164: string): Promise<LaunchResult>;
  whatsApp(e164: string): Promise<LaunchResult>;
}
```

Why: `LaunchResult` is a value, never a thrown error, because on iOS a user *cancelling* the
`tel:` dialog rejects identically to a hard failure (`PLATFORM.md` §5.3). Launching never
completes a reminder (`DOMAIN.md` §9). The interface is extensible to SMS/email without
touching reminder logic (issue `039`).

### 4.6 `UnitOfWork` and repositories

```ts
interface UnitOfWork {
  transaction<T>(work: (repos: Repositories) => Promise<T>): Promise<T>;
}
```

Why: a scheduler run must create reminders and record cycle state atomically, or idempotence is
unprovable. The application layer owns transaction boundaries; the domain never sees them.

---

## 5. How a scheduler run flows

Illustrating the layering on the most important operation:

```text
App launch (app/_layout.tsx)
    → ReconcileOnStartup                            [application]
        → UnitOfWork.transaction:
            SyncContactReferences                   [application]
                → ContactProvider.resolve / findByPhone   [adapter]
                → ContactReference.repair / markUnavailable   [domain, pure]
            RunScheduler                            [application]
                → Schedule.dueOccurrences(clock)    [domain, pure]
                → eligibility(members, history)     [domain, pure]
                → rotation.select(candidates, n, random)   [domain, pure]
                → ReminderInstance.create(...)      [domain, pure]
                → reminderRepo.upsertForOccurrence(...)    [adapter, unique constraint]
            ReconcileNotifications                  [application]
                → NotificationScheduler.listScheduled()    [adapter]
                → diff against pending reminders    [domain, pure]
                → scheduleAt / cancel               [adapter]
```

Every step marked *pure* is a plain function over plain data — no mocks needed, only fakes for
`Clock` and `Random`. That is the payoff of the layering.

### 5.1 Idempotence is enforced at two levels

1. **Domain:** occurrence identity is derived deterministically from
   `(scheduleId, occurrenceInstant)` — the same run recomputes the same identity.
2. **Persistence:** a `UNIQUE(schedule_id, occurrence_at, contact_reference_id)` constraint makes
   duplicate insertion impossible even under a logic error or a concurrent run.

Application-level checking alone is not trusted (`DOMAIN.md` §14.1).

---

## 6. Error handling

- Domain operations that can fail return a `Result<T, DomainError>`; they do not throw.
  Invalid state transitions are values, so they can be asserted in tests.
- Adapters translate platform exceptions into domain-meaningful values at the boundary — a
  missing contact becomes `null`, a failed launch becomes a `LaunchResult`.
- Unexpected exceptions propagate to a presentation-layer boundary that shows a plain error and
  never silently swallows.
- **No operation may destroy user history on failure.** Corrupt or unopenable local data
  surfaces an explicit recovery path; it never auto-wipes (issue `044`).

---

## 7. Testing strategy

| Layer | Test kind | Dependencies | Runs where |
|---|---|---|---|
| `src/domain/**` | unit | none — fakes for Clock/Random | Node, no native build |
| `src/app/**` | use-case | in-memory repository fakes | Node, no native build |
| `src/adapters/persistence/**` | integration | real SQLite | Node via adapter, or device |
| `__tests__/simulation/**` | simulation | seeded Random, fake Clock | Node, no native build |
| Presentation | smoke | mocked use cases | Node |
| Device behaviour | manual | physical iOS + Android | hardware only |

**Constraint from `PLATFORM.md` §3:** `better-sqlite3` needs a native toolchain that is absent
on some machines (including MSVC on Windows). The domain, application, and simulation suites —
the ones that matter most — must therefore run with **zero native dependencies**. Persistence
integration tests are a separate, separately-invocable suite that is allowed to require a
toolchain. CI runs both; a contributor without MSVC can still run the majority.

Device-only verification is enumerated in `docs/PLATFORM.md` §6 and cannot be satisfied in CI.

---

## 8. What is deliberately not in this architecture

- No backend, API client, or network layer of any kind.
- No global mutable state or singleton database handle reachable from the domain.
- No background task runner (`PLATFORM.md` §4).
- No web/PWA target, service worker, or `react-native-web`.
- No state-management library. React state plus use cases is sufficient for Phase A; adding one
  before a measured need would be premature.
- No ORM. Repositories over hand-written SQL keep the schema explicit and migrations honest.
- No dependency-injection framework. `container.ts` is a plain function returning wired objects.

---

## 9. Composition root

`app/_layout.tsx` is the only place where concrete adapters are named:

```ts
const container = createContainer({
  clock: new SystemClock(),
  random: new CryptoRandom(),
  contacts: new ExpoContactProvider(),
  notifications: new ExpoNotificationScheduler(),
  communication: new LinkingCommunicationLauncher(),
  db: await openDatabase(),
});
```

Tests build the same container with fakes. Nothing else in the codebase constructs an adapter,
which is what makes the dependency rules in §2.1 mechanically checkable.
