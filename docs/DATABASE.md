# Database

## Overview

Stay Close uses SQLite via `expo-sqlite` for all persistent data storage. The database lives entirely on the user's device. There is no remote database and no cloud sync.

---

## Technology

| Concern | Decision |
|---|---|
| Engine | SQLite |
| Library | expo-sqlite |
| Language interface | TypeScript (type-safe repository layer) |
| Migration strategy | Sequential versioned migrations |
| Query safety | Parameterised queries only |
| Transaction strategy | Explicit transactions for multi-step operations |

---

## Schema

### Table: `circles`

Stores user-defined relationship circles.

```sql
CREATE TABLE circles (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT    NOT NULL CHECK(length(trim(name)) > 0 AND length(name) <= 100),
  reminder_frequency TEXT NOT NULL CHECK(reminder_frequency IN (
    'daily', 'every_3_days', 'weekly', 'every_2_weeks', 'monthly'
  )),
  created_at      TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_circles_name ON circles(name);
```

**Fields:**

| Field | Type | Notes |
|---|---|---|
| id | INTEGER | Primary key, auto-increment |
| name | TEXT | User-chosen name, trimmed, max 100 chars |
| reminder_frequency | TEXT | Enum: daily, every_3_days, weekly, every_2_weeks, monthly |
| created_at | TEXT | ISO 8601 datetime, UTC |
| updated_at | TEXT | ISO 8601 datetime, UTC |

---

### Table: `circle_people`

Stores the people a user has selected for each circle. Only intentionally selected contacts appear here — not the full address book.

```sql
CREATE TABLE circle_people (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  circle_id           INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  contact_identifier  TEXT    NOT NULL,
  display_name        TEXT    NOT NULL CHECK(length(trim(display_name)) > 0),
  phone_number        TEXT,
  created_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  updated_at          TEXT    NOT NULL DEFAULT (datetime('now')),
  last_suggested_at   TEXT,
  suggestion_count    INTEGER NOT NULL DEFAULT 0,
  UNIQUE(circle_id, contact_identifier)
);

CREATE INDEX idx_circle_people_circle_id ON circle_people(circle_id);
CREATE INDEX idx_circle_people_last_suggested ON circle_people(last_suggested_at);
CREATE INDEX idx_circle_people_suggestion_count ON circle_people(suggestion_count);
```

**Fields:**

| Field | Type | Notes |
|---|---|---|
| id | INTEGER | Primary key, auto-increment |
| circle_id | INTEGER | Foreign key → circles.id, CASCADE DELETE |
| contact_identifier | TEXT | Native OS contact ID (device-specific) |
| display_name | TEXT | Snapshot of contact name at time of selection |
| phone_number | TEXT | Snapshot of selected phone number; nullable |
| created_at | TEXT | ISO 8601 datetime, UTC |
| updated_at | TEXT | ISO 8601 datetime, UTC |
| last_suggested_at | TEXT | ISO 8601 datetime or NULL if never suggested |
| suggestion_count | INTEGER | Total times suggested, default 0 |

**Constraint**: A contact identifier is unique per circle — a person can only be added to a given circle once. They may appear in multiple circles.

---

### Table: `reminder_history`

Records every reminder event. Provides the historical data the reminder engine uses to ensure fairness.

```sql
CREATE TABLE reminder_history (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  circle_id       INTEGER NOT NULL REFERENCES circles(id) ON DELETE CASCADE,
  circle_person_id INTEGER NOT NULL REFERENCES circle_people(id) ON DELETE CASCADE,
  suggested_at    TEXT    NOT NULL DEFAULT (datetime('now')),
  action          TEXT    NOT NULL CHECK(action IN ('shown', 'completed', 'skipped', 'replaced')),
  completed_at    TEXT
);

CREATE INDEX idx_reminder_history_circle_id ON reminder_history(circle_id);
CREATE INDEX idx_reminder_history_person_id ON reminder_history(circle_person_id);
CREATE INDEX idx_reminder_history_suggested_at ON reminder_history(suggested_at);
```

**Fields:**

| Field | Type | Notes |
|---|---|---|
| id | INTEGER | Primary key, auto-increment |
| circle_id | INTEGER | Foreign key → circles.id |
| circle_person_id | INTEGER | Foreign key → circle_people.id |
| suggested_at | TEXT | When this reminder was generated |
| action | TEXT | Enum: shown, completed, skipped, replaced |
| completed_at | TEXT | When the user tapped Done; nullable |

**Actions:**

| Action | Meaning |
|---|---|
| shown | Reminder was displayed to the user |
| completed | User tapped Done |
| skipped | User closed without acting |
| replaced | User tapped "Someone Else" — this person was swapped out |

---

### Table: `settings`

Stores application-level settings.

```sql
CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

**Known settings keys:**

| Key | Values | Default | Notes |
|---|---|---|---|
| notification_privacy | 'private' \| 'detailed' | 'private' | Lock screen content |
| onboarding_completed | 'true' \| 'false' | 'false' | First-run flow |
| contacts_permission_explained | 'true' \| 'false' | 'false' | Has privacy screen been shown |

---

## Migrations

All schema changes are applied through a sequential migration system. Migrations are applied in order, each exactly once. The current schema version is stored in SQLite's built-in `user_version` pragma.

```sql
PRAGMA user_version;          -- Read current version
PRAGMA user_version = N;      -- Set version after applying migration N
```

### Migration File Convention

```
src/db/migrations/
  001_initial_schema.ts
  002_add_suggestion_count.ts     (example future migration)
```

Each migration file exports:

```typescript
export const migration_001: Migration = {
  version: 1,
  up: async (db: SQLiteDatabase) => {
    await db.execAsync(`
      CREATE TABLE circles ( ... );
      CREATE TABLE circle_people ( ... );
      CREATE TABLE reminder_history ( ... );
      CREATE TABLE settings ( ... );
      PRAGMA user_version = 1;
    `);
  }
};
```

### Migration Safety Rules

1. Migrations are applied inside a transaction — if any step fails, the entire migration rolls back
2. Migrations never modify existing data in a way that could cause data loss without a confirmed upgrade path
3. Migrations are tested with before/after database snapshots
4. No code reads from a database at version lower than the code expects

---

## Repository Pattern

Each table has a dedicated repository class. Repositories are the only code that writes SQL. Services call repositories — screens never touch SQL directly.

```
CircleRepository
  - findAll(): Promise<Circle[]>
  - findById(id: number): Promise<Circle | null>
  - create(data: CreateCircleInput): Promise<Circle>
  - update(id: number, data: UpdateCircleInput): Promise<Circle>
  - delete(id: number): Promise<void>

CirclePeopleRepository
  - findByCircleId(circleId: number): Promise<CirclePerson[]>
  - findById(id: number): Promise<CirclePerson | null>
  - add(data: AddPersonInput): Promise<CirclePerson>
  - updateSuggestionData(id: number, data: SuggestionUpdate): Promise<void>
  - remove(id: number): Promise<void>
  - removeByCircleId(circleId: number): Promise<void>

ReminderHistoryRepository
  - findByCirclePersonId(personId: number): Promise<ReminderHistory[]>
  - findRecentByCircleId(circleId: number, limit: number): Promise<ReminderHistory[]>
  - record(data: RecordReminderInput): Promise<ReminderHistory>
  - markCompleted(id: number, completedAt: string): Promise<void>

SettingsRepository
  - get(key: string): Promise<string | null>
  - set(key: string, value: string): Promise<void>
  - delete(key: string): Promise<void>
```

---

## Foreign Key Enforcement

SQLite foreign key enforcement is disabled by default. The application explicitly enables it on every database connection:

```sql
PRAGMA foreign_keys = ON;
```

This is set in the database initialisation code, before any other query runs.

---

## Transaction Strategy

Multi-step operations that must succeed or fail atomically are wrapped in transactions:

```typescript
await db.withTransactionAsync(async () => {
  await circleRepository.delete(id);
  // circle_people and reminder_history are CASCADE deleted
  await notificationService.cancelForCircle(id);
});
```

Backup restore runs entirely within a single transaction. If any part of the restore fails, all changes are rolled back and existing data is preserved.

---

## Parameterised Queries

All SQL uses parameter binding. Examples:

```typescript
// Insert
await db.runAsync(
  'INSERT INTO circles (name, reminder_frequency) VALUES (?, ?)',
  [name, frequency]
);

// Select
await db.getFirstAsync<Circle>(
  'SELECT * FROM circles WHERE id = ?',
  [id]
);

// Update
await db.runAsync(
  'UPDATE circles SET name = ?, updated_at = ? WHERE id = ?',
  [name, now, id]
);
```

String interpolation into SQL is never used. This is enforced by code review and by SQL injection test cases.

---

## Date/Time Handling

- All datetimes are stored as ISO 8601 strings in UTC: `2024-03-15T10:30:00.000Z`
- Application logic converts to local time for display
- SQLite comparisons use string ordering (ISO 8601 sorts correctly)
- `datetime('now')` is used for database-side defaults

---

## Data Integrity Rules

1. A circle must have a non-empty, non-whitespace name
2. A circle's reminder_frequency must be one of the five allowed values
3. A circle_person must belong to a valid circle
4. A circle_person's display_name must be non-empty
5. suggestion_count must be non-negative
6. action in reminder_history must be one of the four allowed values
7. A contact_identifier may appear only once per circle

Violations are caught by CHECK constraints in the schema and by validation in the repository layer before the SQL runs.

---

## Database Tests

Database tests use a real SQLite database in the test environment — not mocks. This ensures:

- Schema creation works
- Migrations apply correctly
- Constraints behave as expected
- Cascade deletes work
- Transactions roll back correctly
- Parameterised queries prevent injection

See TESTING.md for the full database test strategy.

---

## Backup / Restore Data Format

```json
{
  "schema_version": 1,
  "exported_at": "2024-03-15T10:30:00.000Z",
  "circles": [
    {
      "id": 1,
      "name": "Family",
      "reminder_frequency": "weekly",
      "created_at": "...",
      "people": [
        {
          "contact_identifier": "...",
          "display_name": "Alex Example",
          "phone_number": "+1 555 000 0001",
          "suggestion_count": 3,
          "last_suggested_at": "..."
        }
      ]
    }
  ],
  "settings": {
    "notification_privacy": "private"
  }
}
```

Note: `reminder_history` is excluded from backup by default because it is large and the user can start fresh after restoring circles and people. This decision may be revisited.

---

## Performance Considerations

- Indexes are defined on all foreign key columns and frequently queried columns
- The number of circle_people rows is expected to be small (tens to low hundreds) per user
- reminder_history may grow over time — periodic pruning of old records (> 1 year) may be added in a future release
- All database calls are async — they do not block the UI thread
