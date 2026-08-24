# Database Schema

> **Issues:** `006 [Data] Define initial SQLite schema` (#17),
> `007 [Data] Implement local SQLite database and migrations` (#18)
> **Authoritative artifact:** `src/adapters/persistence/migrations/001_initial.ts`.
> This document explains the relationships and the decisions that are not obvious from DDL.

Local SQLite only. No network, no sync, no remote schema (`docs/PRODUCT.md` §4).

---

## 1. Tables

| Table | Holds |
|---|---|
| `contact_references` | People the user has chosen, referencing the native address book |
| `groups` | User-defined relationship categories |
| `memberships` | Many-to-many link between a person and a group |
| `schedules` | A group's connection rule |
| `schedule_occurrences` | Which cycles have been processed — the idempotence anchor |
| `reminder_instances` | What the app asked the user to do |
| `contact_events` | What the user confirmed actually happened |
| `priority_states` | Skip penalty and deprioritization per person |
| `app_settings` | Key/value app configuration |

```text
groups ──1:N── schedules ──1:N── schedule_occurrences
  │                 │
  │ 1:N             │ (SET NULL on delete)
  ▼                 ▼
memberships    reminder_instances ──0:1── contact_events
  │                 │                          │
  └──── N:1 ────────┴──── N:1 ─────────────────┘
                    ▼
            contact_references ──1:0..1── priority_states
```

---

## 2. Decisions that carry weight

### 2.1 Identity anchors on the phone number, not the native id

`contact_references.phone_e164` is `NOT NULL UNIQUE`. `native_id` is **nullable**.

Android may change a contact's `_ID` on aggregation or account sync, and iOS
`CNContact.identifier` is device-local and not preserved across restore
(`docs/PLATFORM.md` §1.3). Anchoring on the native id would lose data whenever the OS
churned it. Instead `native_id` is a repairable fast path, and the normalised E.164 number is
the durable key.

The `UNIQUE` on `phone_e164` also gives us person-level deduplication for free: two native
contacts sharing a number resolve to one `contact_reference`, which is what
`docs/DOMAIN.md` §2 rule 6 requires.

### 2.2 History never cascades

This is the single most important constraint decision in the schema.

`docs/DOMAIN.md` §3 and §10.2 require reminder history and contact history to survive group
deletion, membership removal, schedule changes and native-contact deletion. So:

| Column | Action | Why |
|---|---|---|
| `reminder_instances.group_id` | `ON DELETE SET NULL` | The reminder outlives its group |
| `reminder_instances.schedule_id` | `ON DELETE SET NULL` | The reminder outlives its schedule |
| `contact_events.related_reminder_id` | `ON DELETE SET NULL` | The event outlives the reminder |
| `memberships.group_id` | `ON DELETE CASCADE` | Membership *is* group-scoped; correct to remove |
| `schedules.group_id` | `ON DELETE CASCADE` | A schedule has no meaning without its group |
| everything → `contact_references` | `ON DELETE RESTRICT` | A person is never deleted |

`reminder_instances.group_name_snapshot` is `NOT NULL` so a historical reminder is still
readable after its group is gone — otherwise history would survive but become anonymous.

A `CASCADE` on `reminder_instances.group_id` would silently destroy user history the moment
someone deleted a group. Tests in `__tests__/adapters/migrations.test.ts` assert each of these
behaviours directly, because nothing else would catch a regression here.

### 2.3 Contacts are never deleted, only made unavailable

`availability` is `'available' | 'unavailable'`. When a native contact disappears — deleted,
merged, or unshared under iOS limited access — the row is marked `unavailable` and excluded
from future selection. `ON DELETE RESTRICT` from every referencing table enforces this at the
database level, so an accidental delete fails loudly instead of taking history with it.

### 2.4 Idempotence has a database-level guarantee

Two constraints, not application logic, make the scheduler idempotent
(`docs/DOMAIN.md` §14.1):

- `UNIQUE(schedule_id, occurrence_at, contact_reference_id)` on `reminder_instances` — the
  same person cannot be reminded twice for the same cycle.
- `UNIQUE(schedule_id, occurrence_at)` on `schedule_occurrences` — a cycle cannot be
  processed twice.

`schedule_occurrences` exists specifically so that a cycle which selected **zero** people is
still recorded. Without it, an empty cycle would look unprocessed and be regenerated on every
scheduler run.

### 2.5 Schedules store an anchor, not a resolved date

`month_day` holds the user's chosen anchor (up to 31). Clamping to the last day of a short
month happens at evaluation time in the domain, so a 31-anchored schedule returns to the 31st
in months that have one (`docs/DOMAIN.md` §4.3). Storing a resolved date would permanently
lose the user's intent.

`weekday` and `month_day` are both nullable because which one applies depends on `cadence`.
That cross-column rule is enforced in the domain, where it can produce a useful error, rather
than in a CHECK constraint that could only fail opaquely.

---

## 3. Indexes

Each exists for a specific query on a hot path:

| Index | Serves |
|---|---|
| `idx_reminders_pending (contact_reference_id, state)` | Global pending-contact exclusion (`DOMAIN.md` §6) — deliberately not group-scoped |
| `idx_contact_events_person (contact_reference_id, occurred_at DESC)` | Last-contact lookup, the hottest read in rotation |
| `idx_reminders_state_due (state, due_at)` | Due / overdue task lists |
| `idx_memberships_group (group_id, active)` | Eligible-member enumeration per cycle |
| `idx_contact_refs_native (native_id)` | Fast-path contact resolution |
| `idx_contact_refs_availability` | Filtering unavailable people out of selection |

---

## 4. Migrations

Forward-only and numbered, anchored on `PRAGMA user_version`
(`src/adapters/persistence/Database.ts`).

- Each migration runs inside a transaction, so a failure leaves the schema at its prior
  version rather than half-applied.
- `migrate()` is safe to call on every launch and is a no-op once current.
- `MIGRATIONS` is append-only. A released entry is never edited; a correction is a new
  migration.
- `PRAGMA foreign_keys = ON` is set per connection — it does not persist in the file.
- `assertSchemaCurrent()` lets startup reconciliation fail loudly rather than operate against
  an unexpected schema.

### 4.1 The driver abstraction

Repositories and migrations run against the `SqlDriver` port, not a concrete SQLite binding.
Two implementations:

| Implementation | Used by |
|---|---|
| `ExpoSqlDriver` | production, on device (`expo-sqlite`) |
| `NodeSqlDriver` | tests (`node:sqlite`, built into Node 24) |

This replaced a `better-sqlite3` test adapter that required a native build. That build aborted
the entire devDependency install on a Windows machine without an MSVC toolchain, leaving no
TypeScript, Jest or ESLint at all. `node:sqlite` needs no native toolchain, so the persistence
suite now runs everywhere — and migrations are verified through the same code path that runs
in production.

There is no ORM. Repositories write SQL by hand (`docs/ARCHITECTURE.md` §8).
