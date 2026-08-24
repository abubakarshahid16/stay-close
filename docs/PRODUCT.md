# Stay Close — V1 Functional Specification

> **Status:** canonical. This document supersedes the previous "Circles" product definition.
> **Scope:** Phase A (functional). No visual design decisions appear here.
> **Issue:** `001 [Docs] Document V1 functional specification` (#12)

---

## 1. Purpose

People have family, relatives, close friends, old friends, mentors, and former colleagues
they genuinely care about. Life gets busy. Weeks pass, then months. The relationship weakens
— not because anyone stopped caring, but because nobody remembered to reach out.

Stay Close is a **private, offline relationship-maintenance assistant**. It helps a user
intentionally stay connected with people they care about by deciding *who to reach out to
next* and reminding them at a time they chose.

The app is not where communication happens. The user calls or messages however they normally
would. Stay Close solves exactly one problem: **remembering who to reconnect with, fairly.**

### Core product rule

Every proposed feature must answer:

> Does this directly help the user remember and reconnect with someone they care about?

If the answer is no, it is not built.

---

## 2. What this product is and is not

**It is not:**

- a CRM
- a social network
- a cloud address book
- a messaging or communication platform
- a server-backed reminder service
- an analytics product

**It is:**

> A private, offline relationship-maintenance assistant.

---

## 3. Core workflow

```text
Phone Contacts
      ↓
Reference selected contacts (never copy the address book)
      ↓
Create Groups
      ↓
Configure a connection Schedule per Group
      ↓
Scheduling + fair rotation engine
      ↓
Determine who is due for contact
      ↓
Schedule a local notification
      ↓
Notification delivered
      ↓
Reminder becomes a persistent in-app task
      ↓
User opens the contact
      ↓
User may launch Phone / WhatsApp
      ↓
User MANUALLY resolves the reminder
      ↓
Reminder history + contact history updated
      ↓
History feeds future fair rotation
```

The loop closes on **manual confirmation**. Nothing in this pipeline ever infers that
contact happened.

---

## 4. Offline requirement

The application must be fully functional with all network connectivity disabled.

- No backend
- No cloud database
- No remote API dependency
- No network required for any core function

Acceptance is physical: put a real device in airplane mode and run the entire workflow
(issue `055`). Launching Phone or WhatsApp is exempt only insofar as *those* apps may
themselves want connectivity — Stay Close must not.

If any dependency introduces network communication, it is removed, or its necessity is
documented explicitly with justification.

---

## 5. Privacy requirements (non-negotiable)

Privacy is a core product requirement, not a later enhancement.

The application has:

- no backend, no cloud database, no server-side authentication
- no user accounts, no login, no signup
- no analytics SDK, no telemetry, no advertising SDK, no tracking SDK

The application **never** transmits:

- contacts, names, or phone numbers
- reminder history or relationship history
- any user-generated information

All data stays on the device. See `docs/PRIVACY.md` and `docs/THREAT_MODEL.md`.

### Permissions

Only two permissions are expected in V1, each with a functional justification:

| Permission | Justification |
|---|---|
| Contacts (read) | The native address book is the source of truth for who the user knows and how to reach them. |
| Notifications | Local reminders must be deliverable when the app is closed. |

The app must **not** request: Location, Camera, Microphone, Photos, Bluetooth, Files,
Calendar, or Accounts. Any future permission requires a documented functional justification
in its issue.

The app must degrade gracefully — never crash — when a permission is denied, restricted, or
revoked after the fact.

---

## 6. Phase separation

### Phase A — Functional product (current)

Foundation, architecture, database, contacts, groups, scheduling, rotation, notifications,
reminder lifecycle, contact actions, history, error handling, permissions, persistence,
testing, privacy verification, edge cases, documentation.

Screens in Phase A use **basic lists, buttons, forms, text, and navigation only**. They exist
to exercise functionality.

The goal is `it works`, explicitly **not** `it looks beautiful`.

No issue in Phase A may concern colors, gradients, typography, iconography, animation, cards,
shadows, illustrations, branding, decorative components, or dashboards.

### Phase B — UI/UX (deferred)

Information architecture, navigation design, visual hierarchy, typography, color, icons,
animation, empty/loading/error presentation, onboarding, accessibility polish, responsive
layout, dark mode, visual dashboards, calendar and scorecard presentation, micro-interactions.

Phase B begins only after Functional V1 is complete, tested, and privacy-audited
(issue `058`, milestone M10). Phase B work must not be mixed into Phase A.

---

## 7. V1 functional scope

**In scope:**

- Reference native contacts by stable identifier
- Multiple user-defined Groups; a contact may belong to many
- One active Schedule per Group (data model permits more — see `docs/DOMAIN.md` §5)
- Cadences: daily, every X days, weekly, every X weeks, monthly
- N-people-per-cycle selection, decoupled from interval
- Fair randomized rotation with a testable, seedable randomness abstraction
- Local notifications, no push infrastructure
- Persistent reminder tasks that survive a missed notification
- Reminder resolution: Complete, Snooze, Skip this time, Deprioritize
- Global (cross-group) contact history and last-contact tracking
- Phone and WhatsApp launch actions
- Data foundation sufficient to derive scorecard metrics later

**Out of scope for V1:**

- Accounts, backends, analytics, ads, cloud backup
- JSON backup / restore
- Arbitrary date-time snooze selection
- Complex calendar recurrence semantics
- Visual scorecards, charts, dashboards
- Inspecting or controlling what happens inside WhatsApp, Phone, or SMS

---

### 7.1 Web: a deliberately degraded target

Web was originally **out of scope**, and this document said so. That decision has been
**reversed by the product owner**, so it is recorded here rather than left as a contradiction
between the spec and the code.

Web is supported, but it cannot reach parity, and the reasons are platform facts rather than
implementation gaps:

| Capability | Native | Web |
|---|---|---|
| Pick people from the address book | Yes | **No.** Browsers have no address-book API, so people are typed in by hand |
| Reminders while the app is closed | Yes, OS-scheduled | **No.** Browsers cannot schedule a notification that outlives the tab; that needs Web Push, which needs a server this product will not have |
| Contact sync (name/number repair) | Yes | **No.** There is nothing to sync against |
| Local database | SQLite | SQLite via WASM, which needs cross-origin isolation headers a service worker must supply |

What still works on web: groups, schedules, the rotation engine, the full reminder lifecycle,
history and metrics. The in-app reminder list is the system of record on every platform
(§DOMAIN §11), so a web user sees their due reminders whenever they open the page — they simply
are not nudged when it is closed.

**The honest framing:** web is a way to try Stay Close and to use it at a desk. A phone is where
it works as intended. The UI says so rather than implying parity.

This also reintroduces two things the rebuild had removed — the web bundle and a service worker.
Manual person entry, added for web, doubles as the fallback on a phone when someone declines
contacts access, which is an improvement in its own right: declining a permission should not be a
dead end.

---

## 8. Conflicts with the previous "Circles" product

The prior product on `main` was a different design. It must not be partially revived. Each
conflict below is deliberate and load-bearing.

| Topic | Old "Circles" product | V1 requirement |
|---|---|---|
| Terminology | **Circle** | **Group** |
| Selection algorithm | Weighted score from `last_suggested_at` × never-suggested bonus | **Fair randomized rotation** over a priority ladder — not naive random, not the old weighting |
| Selection quantity | One suggestion at a time, globally | **N people per cycle, per Group**, N configurable |
| Interval meaning | Frequency implied per-person cadence | Interval governs the **cycle**; it does not promise each person is contacted every interval |
| History scope | Suggestion counters on the group member row | **Global contact history keyed to the person**, shared across all Groups |
| Reminder actions | Done / Show someone else / Skip | **Complete / Snooze / Skip this time / Deprioritize** — "Show someone else" is removed |
| Skip semantics | One ambiguous "Skip" | **Skip this time ≠ Deprioritize** — two distinct domain states |
| Snooze | Absent | Predefined options only |
| Persistence of tasks | Suggestion recomputed on screen mount | **Reminder instances are persistent records**; a missed notification never destroys the task |
| Contact deletion | Not modelled | History preserved; contact marked unavailable, excluded from future scheduling |
| Backup | JSON export / import via file system | **Not in V1** |
| Web / PWA | GitHub Pages PWA target | **Re-included, deliberately degraded** — see §7.1 |
| Notification content | Privacy toggle naming the person | Local notification; content policy defined in `docs/DOMAIN.md` §10 |
| Scheduler | Recomputed on render, wrote history on every mount | **Idempotent scheduler**; running it repeatedly yields one logical reminder per occurrence |

Specific anti-requirements, stated so they are not reintroduced by inference:

- Do **not** revive `BackupService`, JSON export/import, or `expo-document-picker` /
  `expo-sharing` for backup purposes.
- Do **not** revive the web/PWA build, `react-native-web`, the service worker, or the
  GitHub Pages deploy as a V1 requirement.
- Do **not** revive "Show someone else" as a reminder action.
- Do **not** reuse the term *Circle* in code, schema, or documentation.
- Do **not** carry over `suggestion_count` / `last_suggested_at` per-membership weighting.

---

## 9. Success criteria for Functional V1

Functional V1 is complete when:

1. Every M1–M9 issue is closed.
2. The full workflow in §3 runs end-to-end on a physical iOS device and a physical Android device.
3. The full workflow runs with networking disabled.
4. The rotation engine passes deterministic fairness simulations.
5. The scheduler is proven idempotent.
6. A dependency, network-independence, and permission audit have all passed.
7. No aesthetic work has been done.

---

## 10. Glossary

| Term | Meaning |
|---|---|
| **ContactReference** | A local row pointing at a native contact by its platform identifier. Not a copy of the contact. |
| **Group** | A user-defined relationship category — Family, Close Friends, Colleagues. |
| **Membership** | The many-to-many link between a ContactReference and a Group. |
| **Schedule** | A Group's connection rule: how many people, how often, which day, what time. |
| **Cycle** | One occurrence of a Schedule firing. |
| **ReminderInstance** | A persistent record that the app asked the user to contact one person for one cycle. |
| **ContactEvent** | A persistent record that the user confirmed contact actually happened. |
| **Eligible** | A contact the rotation engine is permitted to select this cycle. |
| **Pending** | A ReminderInstance that is due or overdue and not yet resolved. |
| **Deprioritized** | A person the user has explicitly pushed down the rotation indefinitely. |

---

## 11. Related documents

- `docs/DOMAIN.md` — entities, rules, state machines, algorithms
- `docs/ARCHITECTURE.md` — layering, abstractions, dependency direction
- `docs/PLATFORM.md` — verified Expo/iOS/Android capabilities and limits
- `docs/PRIVACY.md`, `docs/THREAT_MODEL.md`, `docs/SECURITY.md`
- `docs/TESTING.md` — test strategy
