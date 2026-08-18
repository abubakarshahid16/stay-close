# Architecture

## Overview

Stay Close is a local-first, offline-capable mobile application. All user data — contacts, circles, reminders, and settings — lives exclusively on the user's device. There is no backend server, no cloud database, and no user account system.

The architecture is intentionally simple because simplicity serves both the user and the privacy promise.

---

## System Architecture Diagram

```
┌─────────────────────────────────────────────────┐
│                   USER'S DEVICE                  │
│                                                   │
│  ┌─────────────────────────────────────────────┐ │
│  │            React Native Application          │ │
│  │                (Expo / TypeScript)           │ │
│  │                                              │ │
│  │  ┌──────────────┐    ┌────────────────────┐ │ │
│  │  │  UI Layer     │    │  Business Logic    │ │ │
│  │  │  (Expo Router)│    │  (Services)        │ │ │
│  │  └──────┬───────┘    └────────┬───────────┘ │ │
│  │         │                     │              │ │
│  │  ┌──────▼─────────────────────▼───────────┐ │ │
│  │  │              Data Layer                 │ │ │
│  │  │         (Repositories / SQLite)         │ │ │
│  │  └──────────────────────────────────────── ┘ │ │
│  └─────────────────────────────────────────────┘ │
│                                                   │
│  ┌─────────────────┐  ┌────────────────────────┐ │
│  │  OS Contacts API │  │  OS Notification API   │ │
│  │  (expo-contacts) │  │  (expo-notifications)  │ │
│  └─────────────────┘  └────────────────────────┘ │
│                                                   │
│  ┌─────────────────────────────────────────────┐ │
│  │          Local SQLite Database               │ │
│  │          (expo-sqlite)                       │ │
│  └─────────────────────────────────────────────┘ │
│                                                   │
└─────────────────────────────────────────────────┘

              NO NETWORK CALLS
              NO CLOUD DATABASE
              NO BACKEND SERVER
```

---

## Data Flow

```
User's Phone Contacts
        ↓
OS Contacts API (expo-contacts)
        ↓
Mobile Application (with explicit OS permission)
        ↓
User selects specific people
        ↓
Local SQLite Database (selected people only)
        ↓
Reminder Engine (weighted selection algorithm)
        ↓
Local Notifications (expo-notifications)
        ↓
User responds → history recorded locally
```

**There is no step involving a network request, a cloud server, or a remote database.**

---

## Layer Responsibilities

### UI Layer

- Expo Router file-based navigation
- React Native screens and components
- Local state management (React state + context)
- Calls into Business Logic Layer only — never directly into database or OS APIs
- Renders data returned by business logic

### Business Logic Layer (Services)

- `ContactService` — wraps OS contact permission and loading
- `CircleService` — creates, reads, updates, deletes circles
- `ReminderEngine` — weighted selection algorithm
- `NotificationService` — schedules and manages local notifications
- `BackupService` — exports and imports local data
- `SettingsService` — reads and writes application settings
- Services call into Repositories for persistence
- Services call into OS APIs via Expo abstractions

### Data Layer (Repositories)

- `CircleRepository` — CRUD for circles
- `CirclePeopleRepository` — CRUD for people within circles
- `ReminderHistoryRepository` — records reminder events
- `SettingsRepository` — persists application settings
- All SQL is parameterised — no string concatenation of untrusted values
- All operations wrapped in transactions where appropriate
- Type-safe return types throughout

### Database

- SQLite via expo-sqlite
- Schema migrations versioned and sequential
- Foreign keys enforced
- Indexes on frequently queried columns

---

## Technology Stack

| Concern | Technology | Justification |
|---|---|---|
| Framework | React Native + Expo | Cross-platform, strong Expo ecosystem support |
| Language | TypeScript | Type safety, maintainability |
| Navigation | Expo Router | File-based routing, Expo native support |
| Database | expo-sqlite | Local-only SQLite, no network, well-maintained |
| Contacts | expo-contacts | OS-native contact access, no third-party uploads |
| Notifications | expo-notifications | Local notification scheduling, no push server required |
| Testing | Jest + React Native Testing Library | Standard React Native testing ecosystem |

---

## Dependency Evaluation Criteria

Before any dependency is added, all of the following must be answered:

1. Why is it needed? Cannot Expo already provide this?
2. Is it actively maintained?
3. Does it make network requests?
4. Does it collect telemetry or analytics?
5. Does it require additional OS permissions?
6. Does it contain native code requiring a custom dev client?
7. Does it introduce security concerns?
8. How will it be tested?

Dependencies that make network requests, collect telemetry, or introduce unnecessary permissions will not be added.

---

## Application Structure (Planned)

```
stay-close/
├── app/                        # Expo Router screens
│   ├── (onboarding)/
│   │   ├── index.tsx           # Welcome / what the app does
│   │   ├── contacts-privacy.tsx # Privacy explanation before permission
│   │   └── notifications-privacy.tsx
│   ├── (tabs)/
│   │   ├── index.tsx           # Home — today's suggestion
│   │   └── circles.tsx         # Circles list
│   ├── circles/
│   │   ├── [id].tsx            # Circle detail
│   │   ├── create.tsx          # Create new circle
│   │   └── [id]/select.tsx     # Contact selection for circle
│   └── settings/
│       └── index.tsx           # Settings + backup + delete data
├── src/
│   ├── db/
│   │   ├── database.ts         # Database initialisation + migrations
│   │   ├── migrations/
│   │   │   └── 001_initial.ts
│   │   └── repositories/
│   │       ├── CircleRepository.ts
│   │       ├── CirclePeopleRepository.ts
│   │       ├── ReminderHistoryRepository.ts
│   │       └── SettingsRepository.ts
│   ├── services/
│   │   ├── ContactService.ts
│   │   ├── CircleService.ts
│   │   ├── ReminderEngine.ts
│   │   ├── NotificationService.ts
│   │   ├── BackupService.ts
│   │   └── SettingsService.ts
│   ├── types/
│   │   ├── circle.ts
│   │   ├── contact.ts
│   │   ├── reminder.ts
│   │   └── settings.ts
│   └── utils/
│       ├── validation.ts
│       └── date.ts
├── __tests__/
│   ├── unit/
│   ├── db/
│   ├── components/
│   ├── integration/
│   └── e2e/
├── docs/
└── .github/
```

---

## No-Network Contract

The application must satisfy all of the following at all times:

- No HTTP requests from the application itself
- No third-party SDKs that make HTTP requests
- No Firebase, Firestore, or any cloud database client
- No analytics SDK that phones home
- No crash reporter that sends data over the network
- No advertising SDK
- No dependency that fetches resources on initialisation

This contract is verified:
1. During code review for every PR
2. By a network audit in Phase 10 (Security & Privacy Hardening)
3. By testing in airplane mode as part of QA_CHECKLIST.md

---

## State Management

No external state management library (Redux, Zustand, etc.) is used. The application state requirements are:

- Small enough for React context + local state
- Persistent state lives in SQLite, not in memory
- No complex cross-screen state synchronisation is needed

If state management complexity grows during development, this decision will be revisited via an ADR.

---

## Platform Considerations

### iOS

- Contacts permission: `NSContactsUsageDescription` in Info.plist
- Notification permission: Runtime request via expo-notifications
- Local SQLite database lives in app Documents directory
- App can read contacts but cannot read call logs, messages, or WhatsApp

### Android

- Contacts permission: `READ_CONTACTS` in AndroidManifest.xml
- Notification permission: Runtime request (Android 13+)
- Local SQLite database lives in app-private storage
- No `WRITE_CONTACTS`, `READ_CALL_LOG`, `READ_SMS` permissions — ever

### Both Platforms

- Contact identifiers differ between platforms — the data layer normalises this
- Notification behaviour differs between platforms — tested separately
- App must handle being killed and restarted without data loss
- Scheduled notifications must survive app restart

---

## Backup Architecture

Because there is no cloud sync, Stay Close provides explicit local backup:

```
SQLite Database
      ↓
BackupService.export()
      ↓
JSON document (versioned schema)
      ↓
User shares to Files / Google Drive / iCloud / etc.

Restore path:
User selects backup file
      ↓
BackupService.validate()
      ↓
BackupService.import() — inside a transaction
      ↓
SQLite Database restored
```

Backup files may contain personal information (contact names, circle memberships). The user is informed of this before export. Restore never destroys valid existing data if the import fails — the transaction rolls back.

---

## Security Boundaries

| Data | Location | Network Exposure |
|---|---|---|
| Contact names | SQLite (selected only) | None |
| Phone numbers | SQLite (selected only) | None |
| Circle definitions | SQLite | None |
| Reminder history | SQLite | None |
| App settings | SQLite | None |
| Backup file | User-controlled file system | User's responsibility |

The application has no network boundary to protect because it makes no network requests.

---

## Offline-First Commitment

All core features work with zero network access. See PRODUCT.md for the complete list. This is tested in QA_CHECKLIST.md by explicitly enabling Airplane Mode before testing core flows.
