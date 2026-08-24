# Stay Close — Domain Rules

> **Status:** canonical. Source of truth for all implementation issues.
> **Issue:** `001 [Docs] Document V1 functional specification` (#12)
> **Companion:** `docs/PRODUCT.md` (purpose, scope, phase separation)

This document defines *behaviour*, not storage layout or UI. Schema lives in
`docs/DATABASE.md` (issue `006`); layering lives in `docs/ARCHITECTURE.md` (issue `002`).

---

## 1. Entities

| Entity | Represents | Key rule |
|---|---|---|
| **ContactReference** | A person from the device address book | Stores the *native identifier*, not a copy of the contact |
| **Group** | A user-defined relationship category | Owns a Schedule; deleting it never deletes people or history |
| **Membership** | ContactReference ↔ Group link | Many-to-many; unique per pair |
| **Schedule** | A Group's connection rule | How many people, how often, which day, what time |
| **Cycle** | One occurrence of a Schedule firing | Identified by Schedule + occurrence timestamp |
| **ReminderInstance** | The app asked the user to contact one person for one Cycle | Persistent; survives missed notifications |
| **ContactEvent** | The user confirmed contact actually happened | Global to the person, not the Group |
| **PriorityState** | Skip penalty / deprioritization for a person | Affects selection weight, never deletes data |

### 1.1 ContactReference

Holds:

| Field | Role |
|---|---|
| `nativeId` | Platform contact identifier — fast-path lookup. **Not durable.** |
| `phoneE164` | Normalised international number — **the durable identity anchor** |
| `displayNameCache` | Fallback label, and a secondary match signal |

The **native address book is the source of truth** for identity and phone numbers. The app
must not duplicate the address book. Display name and numbers are resolved from the native
record at read time; the cached name is a degradation path, not the truth.

**The native identifier is not a durable primary key.** Verified in `docs/PLATFORM.md` §1.3:
Android may change a contact's `_ID` on aggregation or account sync, and iOS
`CNContact.identifier` is device-local and not preserved across backup/restore or CardDAV
sync. Identifier churn is therefore an expected condition, not an error.

Resolution order, which makes churn self-healing:

```text
1. look up by nativeId
2. on miss → re-resolve by phoneE164
3. on match → repair nativeId in place, continue normally
4. on failure → mark unavailable (history preserved)
```

Editing a contact, rebooting, and reinstalling on Android do **not** churn identifiers.
Merges, account syncs, device migration, and restore-from-backup do.

An `availability` state distinguishes:

- `available` — native record resolves
- `unavailable` — identifier no longer resolves (contact deleted, or permission lost)

`unavailable` is a **soft** state. It excludes the person from future selection. It never
deletes history.

---

## 2. Contact rules

1. A renamed native contact (`Ahmed` → `Ahmed Khan`) is reflected on next resolution.
2. A changed phone number is used by future communication actions.
3. A deleted native contact:
   - preserves all ContactEvents and ReminderInstances
   - is marked `unavailable`
   - is excluded from future selection
   - never corrupts or rewrites history
4. An invalid or unresolvable identifier is treated as `unavailable`, never as a crash.
5. Synchronisation works fully offline.
6. Two Memberships pointing at the same native identifier resolve to **one** ContactReference.
   Adding a person to a second Group must not create a second person.

### 2.1 Permission states

Handled explicitly: `granted`, **`limited`**, `denied`, `restricted`, `revoked-after-grant`,
`unavailable`.

**`limited` is a distinct first-class state, not a variant of `granted`.** Verified in
`docs/PLATFORM.md` §1.2: on iOS 18+ the platform reports `status: 'granted'` while exposing
only a user-selected subset of the address book — silently, with no error. Treating it as full
access would make the app appear to lose contacts.

Rules for `limited`:

- The app must not assume an absent contact was deleted; it may simply be unshared.
- A member whose contact is unshared resolves as `unavailable` and is excluded from selection,
  but its history and Membership are preserved untouched.
- The user must be able to grant access to more contacts without losing existing data.

On iOS, `restricted` is not distinguishable from `denied` at the API level; a terminal state is
inferred from `canAskAgain === false`.

On loss of Contacts permission the app must: keep all history, keep all Groups and Schedules,
mark contacts `unavailable` for resolution purposes, fail contact operations gracefully, and
allow the user to retry where the platform permits. It must never crash and never delete.

---

## 3. Group and membership rules

A contact may belong to many Groups:

```text
Ahmed
 ├── Family
 ├── Close Friends
 └── University Friends
```

**Removing Ahmed from Family:**

- removes the Family Membership only
- leaves Close Friends and University Friends untouched
- leaves all contact history intact
- cancels *future* Family scheduling for Ahmed
- resolves or cancels Ahmed's unresolved Family reminders (see §8.4)

**Deleting the Family Group:**

- deletes the Group and its Memberships and Schedule
- cancels future reminders originating from that Group
- **preserves** global contact history
- **preserves** historical ReminderInstances (they record what the app asked)
- leaves the native phone contact completely untouched

Empty Groups are valid and supported. Duplicate Membership for the same pair is prevented.

---

## 4. Schedule semantics

A Schedule expresses:

| Field | Meaning |
|---|---|
| `peoplePerCycle` | How many people to select when the Schedule fires |
| `cadence` | How often a new Cycle occurs |
| `dayRule` | Which day the Cycle lands on |
| `timeOfDay` | Local wall-clock time the Cycle fires |
| `active` | Whether the Schedule participates in scheduling |

Worked examples:

```text
Family          30 members   2 people   every 7 days    Sunday      21:00
Old Friends     40 members   1 person   every 30 days   15th        21:00
Close Friends   15 members   3 people   every 14 days   Saturday    20:00
```

### 4.1 People count and interval are independent

This is the single most important scheduling rule.

```text
"2 people every 7 days"
```

means: **each weekly Cycle selects two people.**

It does **not** mean each individual person is contacted every seven days. With 30 members
and 2 per week, an individual comes up roughly every 15 weeks. The rotation engine — not the
interval — decides who is selected.

### 4.2 Supported cadences (V1)

`daily` · `everyXDays` · `weekly` · `everyXWeeks` · `monthly`

Ambiguous vocabulary is banned. Never "bi-weekly". Use `every 14 days` or `every 2 weeks`.

Complex calendar recurrence (nth weekday, exclusion sets, multiple times per day) is out of
scope for V1.

### 4.3 Monthly date behaviour — 29th, 30th, 31st

A monthly Schedule anchored on a day that does not exist in the target month **clamps to the
last day of that month**. It never rolls into the next month, and it never skips the month.

| Anchor | Jan | Feb (non-leap) | Feb (leap) | Apr | Jun |
|---|---|---|---|---|---|
| 29 | 29 | **28** | 29 | 29 | 29 |
| 30 | 30 | **28** | **29** | 30 | 30 |
| 31 | 31 | **28** | **29** | **30** | **30** |

The anchor is stored, not the resolved date, so a 31-anchored Schedule returns to the 31st in
months that have one. Clamping is computed in the device's **local** timezone.

### 4.4 Schedule editing

Changing `Sunday 21:00` to `Saturday 20:00`:

- future Cycles use the new configuration
- past ReminderInstances and history are **never** rewritten
- future notifications are cancelled and rescheduled
- already-pending reminders remain pending and resolvable

### 4.5 Multiple schedules per group

V1 exposes **one active Schedule per Group**. The data model keys Schedules to a Group as a
collection so additional Schedules can be added later without migration of intent. No
multi-rule editor is built in V1.

---

## 5. Eligibility

A member is **eligible** for selection in a Cycle unless any exclusion applies:

| Exclusion | Reason |
|---|---|
| Membership inactive or removed | Not in the Group |
| ContactReference `unavailable` | Native contact deleted or unreadable |
| Has an unresolved ReminderInstance **anywhere** | Global pending exclusion — §6 |
| Already selected earlier in this same Cycle | No duplicates within a Cycle |
| Deprioritized | Per policy in §7.3 — heavily downweighted, and excluded while normal candidates exist |

Eligibility is evaluated fresh at selection time, never cached across Cycles.

---

## 6. Global pending-contact exclusion (default policy)

> **A person with an unresolved reminder is not selected for another reminder — from any
> Group — until the existing reminder is resolved.**

This is the default and V1 policy. It is *global*, deliberately crossing Group boundaries,
because a person belongs to one relationship, not to a Group.

It prevents:

```text
Ahmed pending (Family)
   → Friends cycle fires
   → Ahmed pending (Friends)      ← must not happen
   → Colleagues cycle fires
   → Ahmed pending (Colleagues)   ← must not happen
```

Consequence, accepted deliberately: a Cycle may select fewer than `peoplePerCycle` when
members are pending elsewhere. That is correct — see §7.4.

---

## 7. Fair randomized rotation

Naive random selection is **forbidden**. It produces:

```text
Ahmed · Ahmed · Ahmed · Sara · Ahmed
```

### 7.1 Priority ladder

Candidates are ranked into tiers, highest first:

```text
1. Never contacted
2. Longest time since last contact
3. Previously skipped (penalty decaying over time)
4. Recently contacted
5. Explicitly deprioritized
```

Selection walks the ladder from the top, filling `peoplePerCycle`. **Within a tier**,
selection is randomized — this is what prevents deterministic alphabetical or
insertion-order bias while keeping fairness.

### 7.2 Skip this time

> "Not right now, but keep this person in my normal rotation."

- resolves the current ReminderInstance as `skipped`
- person stays in the Group and stays eligible
- applies a **temporary** selection penalty so they are not immediately reselected
- the penalty **decays**, returning the person to normal rotation
- no ContactEvent is written — nothing was confirmed

### 7.3 Deprioritize

> "Don't prioritise this person for the foreseeable future."

- resolves the current ReminderInstance as `deprioritized`
- person **remains** in the Group
- person **remains** in all history
- selection priority is reduced to the bottom tier, indefinitely — no decay
- while any non-deprioritized eligible candidate exists, deprioritized people are not selected
- reactivation is explicit and user-initiated; it is never automatic
- **never** deletes the contact, the Membership, or any history

Skip and Deprioritize are **distinct domain states**. They must not collapse into one
ambiguous "skipped" flag.

### 7.4 Small groups and insufficient candidates

- Asked for 5, only 3 eligible → select **3**. Not an error.
- Asked for 5, only 1 eligible → select **1**.
- Asked for 5, 0 eligible → create **no** reminders. Not an error, not a crash.
- **Never** select the same person twice in one Cycle.
- Rotation resumes naturally as people become eligible again.

### 7.5 Testability

Randomness is injected through an abstraction with a seedable implementation. Tests use a
fixed seed and a controllable clock, so fairness assertions are deterministic and never
flaky. Production uses the unseeded implementation.

---

## 8. Reminder lifecycle

### 8.1 States

```text
Scheduled
    ↓
  Due
    ↓
 Pending ──┬── Completed      (terminal)
           ├── Snoozed  → returns to Pending
           ├── Skipped       (terminal)
           └── Deprioritized (terminal)

Pending, unresolved past its due window → Overdue (still Pending, still resolvable)
```

### 8.2 Transition rules

- Invalid transitions are rejected, not silently ignored.
- `Completed` is **final** for that occurrence.
- `Skipped` and `Deprioritized` resolve the occurrence.
- `Snoozed` modifies the existing instance — it **never** creates a second reminder.
- `Overdue` is a classification of an unresolved reminder, not a resolution. History is retained.
- No transition ever deletes a ReminderInstance.

### 8.3 Persistence

The **notification is transient. The reminder task is persistent.**

- A missed notification never destroys the task.
- App restart preserves all pending state.
- Old pending reminders remain visible and resolvable, classified as overdue.
- A reminder is never auto-deleted merely because the user ignored the notification.

Presentation grouping (functional, not visual):

```text
Due today      Ahmed
Due yesterday  Sara
Overdue        Ali
```

### 8.4 Group and membership removal with pending reminders

When a Group is deleted or a Membership removed while reminders are unresolved, those
reminders are **cancelled** — resolved to a terminal `cancelled` classification that records
*why* — and their notifications are cancelled. History is preserved. Cancellation is not
completion and must not write a ContactEvent.

### 8.5 Snooze

Predefined options only. Arbitrary date-time picking is **not** in V1.

| Option | Effect |
|---|---|
| 30 minutes | due + 30m |
| 1 hour | due + 1h |
| 3 hours | due + 3h |
| Tomorrow | next local day at the Schedule's `timeOfDay` |
| Next scheduled occurrence | the Schedule's next Cycle time |

Snooze reschedules the notification, modifies the existing reminder, creates **no** duplicate,
and leaves the Group's Schedule unchanged.

---

## 9. Completion, and what must never be inferred

Completion is **manual and explicit**. The following do **not** complete a reminder:

- a reminder being generated
- a notification being delivered
- a notification being opened
- launching WhatsApp
- launching the Phone app
- returning to the app afterwards

The app cannot know whether a message was sent or a call connected, and must never pretend
to. Only the user's explicit confirmation completes a reminder.

On completion:

1. ReminderInstance → `completed`
2. A **ContactEvent** is written for the person
3. Last-contacted becomes derivable from that event, globally
4. Future rotation in **every** Group sees the new timestamp
5. Any future notification for that occurrence is cancelled

---

## 10. Reminder history vs contact history

These are separate and must not be conflated.

**Reminder history** — what the app *asked*:

```text
Reminder  Ahmed
Scheduled 2026-08-16 21:00
Status    Skipped
```

**Contact history** — what the user *confirmed*:

```text
Contact   Ahmed
Occurred  2026-08-16 21:20
Source    reminder-completion
```

### 10.1 Global contact history

Contact history belongs to the **person**, never to a Group.

If Ahmed is in Family and Friends, and the user completes a Family reminder for Ahmed, then
the Friends rotation must immediately see Ahmed as recently contacted. Otherwise Friends
would select him again the same day, defeating the product.

### 10.2 Durability

History survives: Membership removal, Group deletion, Schedule change, Schedule deletion, and
native-contact deletion.

### 10.3 Manual contact logging

The ContactEvent write path is designed so a future explicit "Log contact" action can insert
an event with a null reminder link — recording a real interaction **without fabricating a
reminder**. V1 ships manual resolution of due and overdue reminders; the schema does not need
to change to add direct logging later.

---

## 11. Notification policy

- **Local** notifications only. No push, no FCM, no APNs, no server.
- The app must not need to be open. Delivery is expected with the app foregrounded,
  backgrounded, closed, and the device locked, to the extent the OS and granted permissions
  allow.
- One notification per scheduled reminder. The user is never spammed.
- Completing or cancelling a reminder cancels its pending notification.
- Snoozing reschedules it.
- Duplicate notifications for one logical reminder are prevented.
- If notification permission is denied or revoked, the app **remains fully functional** —
  reminders still exist as in-app tasks. This is a degradation, not a failure.

Platform-specific limits (pending-notification caps, reboot survival, background execution)
are recorded in `docs/PLATFORM.md` and drive the reconciliation design.

---

## 12. Communication actions

Minimum V1 actions: **Phone call** and **WhatsApp**.

- Implemented with OS deep links. No WhatsApp API access, no message inspection.
- The correct phone number for the ContactReference is used.
- A missing or malformed number is handled gracefully.
- WhatsApp not installed must **not** crash — the failure is surfaced and the reminder stays
  actionable.
- Launching either app never auto-completes the reminder (§9).

The action layer is abstracted so SMS, email, or other channels can be added later without
touching reminder logic.

---

## 13. Time handling

Time is a first-class domain concern, accessed only through a clock abstraction — never by
calling the system clock inline.

Explicitly handled: local timezone, timezone change, device clock change, DST transitions,
day boundaries, month boundaries, reboot, app restart, notification rescheduling, schedule
edits, and snooze arithmetic.

- Cycle times are **local wall-clock** — `21:00` means 21:00 where the user is.
- Instants (contact events, resolutions) are stored as absolute UTC timestamps.
- A DST transition must not duplicate or skip a Cycle.
- Tests use a fake clock. No test may depend on the real current time.

---

## 14. Scheduler contract

The scheduler determines: which Schedules are due, which members are eligible, which are
excluded, their priority, how many to select, which ReminderInstances to create, and which
notifications to schedule. It also reconciles after edits, restarts, and reboots.

### 14.1 Idempotence

> Running the scheduler repeatedly for the same Cycle produces **one** logical reminder per
> selected person.

```text
run scheduler  →  1 reminder
run scheduler  →  still 1 reminder
run scheduler  →  still 1 reminder
```

Enforced by a uniqueness constraint on (Cycle occurrence, person), not by application-level
guesswork alone.

### 14.2 Startup reconciliation

On launch, without any network:

1. Open the database and validate the schema
2. Run pending migrations
3. Resolve contact references against the native address book
4. Recover pending and overdue reminders
5. Reconcile Schedules and generate any missed Cycles
6. Reconcile OS notifications against pending reminders
7. Schedule missing future notifications
8. Create no duplicates of anything

---

## 15. Derivable metrics (data foundation only)

No scorecard UI is built in Phase A. The persisted data must be sufficient to *derive*:

total contacts · completed · skipped · snoozed · overdue · people not recently contacted ·
per-Group completion rate · recent activity · current and longest streak · average contact
interval · people contacted in a period

These are computed from ReminderInstances and ContactEvents. Redundant denormalised counters
are avoided unless a measured performance need justifies one.

---

## 16. Edge cases (normative)

| Case | Required behaviour |
|---|---|
| Duplicate-looking native contacts | Distinct identifiers are distinct people; user chooses |
| Contact with multiple numbers | One number is selected per ContactReference |
| No contacts on device | App remains usable |
| Empty Group | Scheduler creates no reminders, no error |
| One-member Group | Rotation works; that member is selected |
| Requested > available | Select all available, no duplicates |
| All members pending | Create no reminders |
| All members deprioritized | Select from deprioritized tier rather than nothing |
| Native contact deleted | History intact, marked unavailable, excluded |
| Group deleted with pending reminders | Reminders cancelled, history preserved |
| Schedule disabled or deleted | Future reminders reconciled, history untouched |
| Schedule changed | History unchanged, future reconciled |
| Restart during pending reminder | Reminder still pending and correct |
| Restart after completion | Completion persisted |
| Notification permission revoked | In-app tasks continue working |
| Contacts permission revoked | History intact, graceful degradation |
| Month boundary | §4.3 clamping applies |
| Timezone change | Future Cycles consistent, no duplicate or skipped Cycle |
| Device reboot | Notifications reconciled per `docs/PLATFORM.md` |
