# Stay Close Technical Architecture

## Goal

Stay Close uses a simple offline-first Expo, React Native, and TypeScript architecture. The design
keeps product logic outside React components so scheduling, rotation, reminders, history, and
persistence can be tested without a phone UI.

## Layer Diagram

```text
Presentation
React Native screens, forms, lists, buttons, navigation
        |
        v
Application / Use Cases
Create group, sync contacts, run scheduler, complete reminder
        |
        v
Domain
Entities, value objects, validation, recurrence, rotation, reminder state machine
        |
        v
Ports
Repository, contacts, notifications, clock, random, communication launcher
        |
        v
Adapters
SQLite, Expo Contacts, Expo Notifications, Linking, system clock, crypto/random source
```

Dependency direction is one-way. Outer layers may call inner layers through explicit interfaces.
Inner layers must not import React, Expo, SQLite drivers, or navigation code.

## Folder Structure

```text
app/
  _layout.tsx
  index.tsx
  groups/
  reminders/
src/
  domain/
    contact/
    group/
    schedule/
    rotation/
    reminder/
    history/
    shared/
  usecases/
    contacts/
    groups/
    schedules/
    scheduler/
    reminders/
    history/
    startup/
  ports/
    Clock.ts
    Random.ts
    ContactProvider.ts
    NotificationScheduler.ts
    CommunicationLauncher.ts
    repositories.ts
  adapters/
    contacts/
    notifications/
    persistence/
    communication/
    system/
  ui/
    AppContext.tsx
    basic components and hooks
  testing/
    fakes and test helpers
__tests__/
  domain/
  usecases/
  adapters/
  app/
docs/
```

## Presentation Layer

The Phase A UI is a thin functional shell. It may contain basic navigation, lists, buttons, forms,
and simple text needed to exercise workflows.

Presentation must not contain:

- SQL.
- Rotation decisions.
- Schedule recurrence calculations.
- Reminder state transition rules.
- Contacts permission policy.
- Notification reconciliation policy.

React components call use cases and render their results.

## Application / Use Case Layer

Use cases coordinate domain logic with persistence and platform ports.

Examples:

- `CreateGroup`
- `AddContactToGroup`
- `SyncContactReferences`
- `SaveSchedule`
- `RunScheduler`
- `CompleteReminder`
- `SnoozeReminder`
- `SkipReminder`
- `DeprioritizeReminder`
- `ReconcileStartupState`

Use cases should be deterministic when passed fake ports. They should return explicit success or
failure results instead of throwing for normal business-rule failures.

## Domain Layer

The domain layer contains the rules from `docs/DOMAIN.md`.

It owns:

- Entity shapes and validation.
- Schedule recurrence semantics.
- Monthly date behavior.
- Contact eligibility rules.
- Fair randomized rotation.
- Reminder lifecycle transitions.
- History-derived recency calculations.

Domain code must not import React Native, Expo, SQLite, or network APIs.

## Ports

Ports are TypeScript interfaces that describe what the application needs from the outside world.

Required ports:

- `Clock`: returns the current time and supports test-controlled time.
- `Random`: produces deterministic random values in tests.
- `ContactProvider`: reads native contacts and contact permission state.
- `NotificationScheduler`: schedules, cancels, and lists local notifications.
- `CommunicationLauncher`: opens Phone or WhatsApp actions.
- `Repositories`: persist and query local app data.

Ports make the app testable because tests can replace the phone and database with fakes.

## Persistence

Use local SQLite persistence with migrations from day one.

SQLite stores app-owned data:

- Contact references.
- Groups.
- Group memberships.
- Schedules.
- Reminder records.
- Reminder history.
- Confirmed contact history.
- Deprioritization state.
- Notification scheduling references.

SQLite must not store a full copy of the user's address book. Native Contacts remain the source of
truth for names and phone numbers when permission is available.

Screens do not execute raw SQL. Persistence adapters implement repository interfaces.

## Scheduler Architecture

The scheduler is an application service with pure domain helpers. It receives:

- `Clock`
- `Random`
- Repositories
- Notification scheduler port

The scheduler:

1. Loads active schedules.
2. Determines due schedule cycles.
3. Loads eligible group members and global history.
4. Excludes contacts with unresolved reminders by default.
5. Uses fair randomized rotation to select up to the requested people per cycle.
6. Creates persistent reminder records.
7. Schedules one local notification per reminder where permission and platform behavior allow it.
8. Records enough cycle identity to be idempotent.

Running the scheduler multiple times for the same cycle must not create duplicate reminder records
or duplicate notifications.

## Notifications

Notifications use local OS scheduling only. Server push is out of scope.

The notification adapter should hide Expo-specific details behind `NotificationScheduler`.
Startup reconciliation compares persisted reminder state with scheduled notification state and fixes
missing or duplicate notifications where possible.

Notification delivery does not prove contact completion. Completion is always a manual user action.

## Contacts

The contacts adapter hides Expo Contacts APIs behind `ContactProvider`.

The app handles:

- Permission granted.
- Permission denied.
- Permission revoked later.
- Deleted native contact.
- Changed native contact display name.
- Changed phone numbers.
- Contacts unavailable.

Contact synchronization updates local references without destroying history.

## Communication Actions

Communication launching is isolated behind `CommunicationLauncher`.

The app supports:

- Phone call links.
- WhatsApp links.

Failures such as missing phone number, unsupported URL, or WhatsApp not installed return explicit
errors and must not crash the app.

## Testing Strategy

Use automated tests as early as possible.

Test levels:

- Domain tests for validation, recurrence, rotation, reminder transitions, and recency.
- Use-case tests with fake repositories, fake clock, fake random source, and fake platform ports.
- Adapter tests for SQLite migrations and repository behavior.
- React Native Testing Library tests only where UI behavior matters.
- Device validation for iOS and Android contacts, notifications, background behavior, and deep links.

Time is faked through `Clock`. Randomness is faked through `Random`, usually with a seeded
implementation. Tests must not depend on real current time or uncontrolled random selection.

## Expo Go and Development Builds

Expo Go can be used for early development where supported. Platform-sensitive features must be
verified in issue `003` before final implementation decisions:

- Contacts behavior.
- Notification scheduling and delivery.
- Background and closed-app behavior.
- Device reboot behavior.
- iOS and Android permission differences.
- Whether a development build is required for any V1 capability.

## Privacy Boundary

No layer should introduce a backend, account system, remote API, analytics SDK, advertising SDK, or
tracking SDK for core V1 behavior.

Network access is not part of the functional core. Any future dependency that may communicate over
the network requires a privacy review issue before use.

## Web / PWA Boundary

Web and PWA behavior from the old implementation is not a V1 target. The architecture may avoid
blocking future web support, but it must not delay iOS and Android functional completion.
