# Testing Strategy

## Philosophy

Testing is not optional. A feature is not complete because the code exists. A feature is not complete because the screen looks correct. A feature is complete only when automated tests pass and manual QA confirms the behaviour.

Tests ship in the same PR as the feature. There is no "tests later" in this project.

---

## Testing Stack

| Tool | Purpose |
|---|---|
| Jest | Test runner |
| React Native Testing Library | Component and integration testing |
| expo-sqlite in-memory / test database | Real SQLite behaviour in tests |
| jest.useFakeTimers() | Time control for scheduling tests |
| Seeded PRNG | Deterministic reminder engine tests |
| Custom mock for expo-contacts | Contact permission and loading tests |
| Custom mock for expo-notifications | Notification scheduling tests |

---

## Testing Pyramid

### Level 1 — Unit Tests

Target: Individual functions and classes in isolation.

Location: `__tests__/unit/`

Examples:
- Reminder engine weight calculation
- Input validation functions
- Date utility functions
- Backup JSON serialisation
- Contact normalisation logic

All pure business logic is unit-tested.

---

### Level 2 — Database Tests

Target: Repository classes against a real SQLite database.

Location: `__tests__/db/`

These tests use `expo-sqlite` with a real SQLite database in the test environment (in-memory or temp file). They do NOT use mocked databases. This is the only way to verify:
- Schema creation
- Migration correctness
- Constraint enforcement
- Cascade deletes
- Transaction rollback
- Parameterised query correctness

Each test suite creates a fresh database. Tests are isolated from each other.

---

### Level 3 — Component Tests

Target: React Native UI components rendered with React Native Testing Library.

Location: `__tests__/components/`

Examples:
- CircleCard renders circle name and frequency
- ContactListItem renders name and selection state
- HomeScreen shows suggestion or empty state
- Permission explanation screen shows correct content
- Error states render appropriate messages

Tests verify actual rendered content and user interactions — not snapshots alone.

---

### Level 4 — Integration Tests

Target: Multiple layers working together.

Location: `__tests__/integration/`

Examples:
- CircleService + CircleRepository + real SQLite: create circle, add people, verify persisted
- ReminderEngine + ReminderHistoryRepository: run engine, verify history updated, run again
- NotificationService + circle creation: verify notification is scheduled
- Contact selection + circle save: contact flows through to database

Integration tests may use real SQLite and mock OS APIs (expo-contacts, expo-notifications).

---

### Level 5 — End-to-End Tests

Target: Full user journeys through the application.

Location: `__tests__/e2e/`

Tool: To be confirmed — Maestro or Detox (decision captured in ADR).

Key journeys to automate:

**Journey 1 — First-Time Setup**
```
Open App → See Onboarding → Allow Contacts (mocked) →
Create Family Circle → Select People → Choose Weekly →
Enable Notifications → See Home Screen
```

**Journey 2 — Reminder Resolution**
```
Open App → See Suggested Person → Tap Done →
History Updated → Home Returns to Waiting State
```

**Journey 3 — Someone Else**
```
Open App → See Suggested Person → Tap Someone Else →
Different Person Shown → First Person Not Shown Again Immediately
```

**Journey 4 — Edit Circle**
```
Navigate to Circle → Remove Person →
Return to Home → Removed Person Cannot Be Suggested
```

**Journey 5 — Backup and Restore**
```
Export Backup → Verify File Exists →
Delete All Data → Restore Backup →
Verify Circles and People Match
```

---

### Level 6 — Manual Device QA

Location: documented in QA_CHECKLIST.md

Scenarios that cannot be fully automated:
- First installation on a real device
- Real OS contact permission dialog
- Real notification delivery
- Device restart notification persistence (Android)
- Airplane mode core functionality
- Very large contact lists (hundreds of real contacts)
- Accessibility with screen readers (VoiceOver / TalkBack)

---

## Reminder Engine Tests (Detailed)

The reminder engine requires extensive coverage due to its core importance.

### Unit Tests

```
ReminderEngine
  ├── returns null for empty circle
  ├── returns the single person in a one-person circle
  ├── never-suggested people have higher weight than recently-suggested
  ├── applies never-suggested bonus (3×) correctly
  ├── recency factor is 0 for person suggested today
  ├── recency factor is 1.0 for person suggested exactly frequency-days ago
  ├── recency factor caps at 2.0
  ├── last-suggested person is excluded when alternatives exist
  ├── last-suggested person is included when they are the only person
  ├── Someone Else exclusion prevents immediate repeat within session
  ├── malformed last_suggested_at treated as null (never suggested)
  ├── malformed suggestion_count treated as 0
  └── all-zero weights fallback selects uniformly

WeightCalculator
  ├── base weight is 1.0
  ├── never-suggested bonus applies when suggestion_count === 0
  ├── no bonus when suggestion_count > 0
  ├── recency factor correct for each frequency
  └── final weight is product of factors

WeightedSelect
  ├── returns null for empty array
  ├── returns item for single-item array
  ├── distributes selections proportionally to weights (seeded)
  └── handles floating-point edge cases
```

### Statistical Distribution Tests (Seeded)

Using a seeded PRNG, run 2,000 selections over a circle with:
- 1 never-suggested person
- 3 people suggested at varying recencies

Verify:
- Never-suggested person is selected at least 50% of the time in first 100 selections
- After suggestion_count > 0, distribution normalises toward recency-based weights
- Every person with suggestion_count > 0 is selected at least once per 500 selections
- No person with positive eligibility is permanently starved (across 2,000 selections)

These tests use fixed seeds and deterministic bounds — they never flake.

---

## Database Tests (Detailed)

```
CircleRepository
  ├── creates circle with valid data
  ├── rejects empty circle name
  ├── rejects whitespace-only circle name
  ├── rejects name exceeding 100 characters
  ├── rejects invalid reminder_frequency value
  ├── reads created circle
  ├── updates circle name
  ├── updates reminder_frequency
  ├── deletes circle
  ├── cascade deletes circle_people on circle delete
  ├── cascade deletes reminder_history on circle delete
  └── returns null for missing ID

CirclePeopleRepository
  ├── adds person to circle
  ├── rejects duplicate contact_identifier in same circle
  ├── allows same contact_identifier in different circle
  ├── removes person
  ├── updates suggestion data
  ├── reads people by circle ID
  └── returns empty array for circle with no people

ReminderHistoryRepository
  ├── records shown event
  ├── records completed event
  ├── records skipped event
  ├── records replaced event
  ├── marks entry as completed
  ├── finds recent entries by circle ID
  └── rejects invalid action value

SettingsRepository
  ├── sets and gets value
  ├── updates existing value
  ├── returns null for missing key
  └── deletes key

Migrations
  ├── v1 schema creates all tables
  ├── v1 schema creates all indexes
  ├── foreign keys are enforced
  ├── migration is idempotent (applying same version twice is safe)
  └── migration runs inside transaction — rolls back on failure

Transactions
  ├── failed transaction rolls back all changes
  └── concurrent operations are safe
```

---

## Contact Tests (Detailed)

```
ContactService
  ├── returns contacts when permission is granted
  ├── returns permission denied state when denied
  ├── returns restricted state when restricted (iOS)
  ├── returns empty array when no contacts exist
  ├── handles contact with no display name
  ├── handles contact with no phone number
  ├── handles contact with multiple phone numbers
  ├── handles Unicode contact name
  ├── handles emoji in contact name
  ├── handles very long contact name
  ├── refreshes contact data for stored contact
  ├── returns not-found for deleted contact
  └── does not log contact name in production

ContactSelectionScreen
  ├── renders list of contacts
  ├── filters contacts by search query
  ├── shows empty state for no search results
  ├── selects a contact on tap
  ├── deselects a contact on second tap
  ├── supports multi-selection
  ├── already-added contacts are shown as selected
  ├── confirms selection with Add button
  ├── shows contact count in Add button label
  └── handles zero contacts (empty state)
```

---

## Notification Tests (Detailed)

```
NotificationService
  ├── schedules notification for new circle
  ├── reschedules when frequency changes
  ├── cancels notification when circle deleted
  ├── does not schedule when circle has 0 people
  ├── uses correct interval for each frequency value
  ├── uses circle-scoped notification identifier
  ├── private mode notification contains no name
  ├── detailed mode notification contains person name
  ├── handles permission denied gracefully
  ├── handles permission revoked gracefully
  └── multiple circles have independent schedules
```

---

## Backup Tests (Detailed)

```
BackupService
  ├── exports circles and people to JSON
  ├── exported JSON includes schema version
  ├── imported backup restores circles
  ├── imported backup restores people
  ├── imported backup restores settings
  ├── empty backup imports without error
  ├── rejects backup with missing schema_version
  ├── rejects backup with unsupported schema_version
  ├── rejects malformed JSON (parse error)
  ├── rejects backup exceeding maximum size
  ├── rejects backup with missing required fields
  ├── rejects backup with wrong field types
  ├── failed import rolls back — existing data preserved
  ├── restore after fresh install works
  └── duplicate identifiers in backup are handled safely
```

---

## Code Coverage

Configure Jest to collect coverage for:

- `src/services/` — target: >90%
- `src/db/repositories/` — target: >95%
- `src/db/migrations/` — target: 100%
- `src/utils/` — target: >90%
- UI components — target: >80% (lines covered by component tests)

Coverage reports are generated in CI. Coverage percentage is a signal, not a goal. Do not write empty tests to inflate numbers.

---

## Test Data Policy

All test fixtures use fake placeholder contacts:

```typescript
export const FAKE_CONTACTS = {
  alex: { id: 'fake-001', name: 'Alex Example', phone: '+1 555 000 0001' },
  jamie: { id: 'fake-002', name: 'Jamie Example', phone: '+1 555 000 0002' },
  taylor: { id: 'fake-003', name: 'Taylor Example', phone: '+1 555 000 0003' },
  jordan: { id: 'fake-004', name: 'Jordan Example', phone: '+1 555 000 0004' },
  sam: { id: 'fake-005', name: 'Sam Example', phone: '+1 555 000 0005' },
};
```

Real contact names and phone numbers are never used in any test or fixture.

---

## Regression Policy

Every bug fix must include a regression test:

```
Bug discovered
    ↓
Create failing test that reproduces the bug
    ↓
Confirm the test fails (as expected)
    ↓
Fix the bug
    ↓
Confirm the test passes
    ↓
Run full test suite — confirm nothing regressed
```

Bugs fixed without regression tests are treated as incomplete fixes.

---

## CI Test Requirements

CI runs on every PR:

```bash
npm ci
npm run lint
npm run typecheck
npm test -- --coverage
npm run test:db          # database integration tests
npm run test:integration # integration tests
```

PRs must not be merged while any CI check fails.

---

## Known Testing Limitations

| Limitation | Mitigation |
|---|---|
| Real device notification delivery cannot be automated in CI | Manual QA in QA_CHECKLIST.md |
| Android boot receiver cannot be tested in Jest | Manual QA on real Android device |
| Real OS contact permission dialog cannot be automated in unit/component tests | expo-contacts is mocked; real permission tested manually |
| VoiceOver / TalkBack behaviour cannot be verified in Jest | Manual accessibility QA |
| Very large contact lists (1000+) not practical in unit tests | Performance integration test with generated contacts |

---

## Reporting

Test results are reported in CI. For major releases, a QA summary is created referencing:
- Automated test pass/fail status
- Coverage report
- Manual QA checklist completion
- Known issues and their status
