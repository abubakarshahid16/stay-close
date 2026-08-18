# Product Definition

## Problem

**People forget to reconnect with people they care about.**

People have family members, cousins, relatives, friends, old friends, colleagues, classmates, and other important people in their lives. They genuinely care about these people. But life becomes busy. They forget to call. They forget to send a message. They think: "I should contact them sometime." Then weeks or months pass. Relationships slowly weaken — not necessarily because people stopped caring, but because they simply forgot to reconnect.

## Solution

**A private, local-first mobile app that intelligently reminds users which person they should reconnect with.**

Stay Close privately uses the user's existing contacts. The user creates relationship circles such as Family, Close Friends, Old Colleagues. The user selects people from their device contacts and adds them to those circles. The user chooses how frequently the app should remind them. The application then intelligently and fairly chooses a person from that circle and reminds the user:

> Reach out to Ahmed today.

The app does not become the place where communication happens. The user calls, texts, WhatsApps, or communicates however they normally do. Stay Close only solves: **remember who to reconnect with.**

---

## Core Product Rule

Every product decision must answer:

> Does this directly help the user remember and reconnect with someone they care about?

If the answer is NO, do not build it.

---

## User Journey

### First-Time Experience

```
Install App
   ↓
Open App
   ↓
Understand What It Does  (brief onboarding — 2–3 screens)
   ↓
Privacy Explanation for Contacts
   ↓
Allow Contact Access (OS permission)
   ↓
Create a Circle (e.g. "Family")
   ↓
Select People From Existing Contacts
   ↓
Choose Reminder Frequency (e.g. "Weekly")
   ↓
Privacy Explanation for Notifications
   ↓
Enable Reminders (OS notification permission)
   ↓
Done — Home Screen
```

### Normal Daily Use

```
Local Notification Appears on Device
        ↓
"You have someone to reconnect with."
(or "Maybe reach out to Ahmed today." if detailed mode enabled)
        ↓
User Opens App
        ↓
Home Screen Shows Suggested Person
        ↓
User Calls / Messages / Reconnects
        ↓
User Taps "Done"
        ↓
Reminder History Updated
        ↓
Next Reminder Scheduled
```

### Alternative Actions

```
Suggested Person → "Someone Else"
        ↓
App Selects Different Eligible Person
        ↓
New Suggestion Shown
```

```
Suggested Person → "Call"
        ↓
Device Phone App Opens with Number
        ↓
User Completes Call Externally
        ↓
User Returns to App → Taps "Done"
```

---

## Product Scope

### What We Build

1. Access device contacts privately (OS permission, local only)
2. Let users select important people from contacts
3. Organise selected people into named circles
4. Set per-circle reminder frequency
5. Intelligently select who should be suggested using a fair weighted algorithm
6. Create local device reminders (no push notification backend)
7. Allow the user to call, reach out, or open an action
8. Allow Done or Someone Else responses
9. Manage circles and selected people (add, edit, remove)
10. Keep all data locally stored in SQLite
11. Backup and restore local data to a file
12. Protect notification privacy (private mode by default)
13. Delete all application data on demand
14. Work offline — zero internet required for core functionality
15. Be extremely easy to use for non-technical family members

### What We Explicitly Do Not Build

- Social feed or activity stream
- User profiles or accounts
- Followers, friend requests, or in-app social features
- In-app messaging or chat
- AI chat or AI relationship coaching
- Cloud sync or cloud database
- Advertising or monetisation systems
- Analytics or behavioral tracking
- Relationship scores, streaks, badges, or gamification
- Location features
- SMS, WhatsApp, or call content reading
- Call recording or monitoring
- Conversation tracking or surveillance of any kind
- Background contact syncing without explicit user action
- Automatic contact import

---

## Circles

Circles are user-defined groups of people the user wants to stay connected with.

Examples:
- Family
- Close Friends
- Cousins
- Old Friends
- College Friends
- People I Want to Stay Connected With
- Work Colleagues

Each circle has:
- A user-chosen name
- A reminder frequency (Daily, Every 3 days, Weekly, Every 2 weeks, Monthly)
- A list of selected people from the user's device contacts

---

## Reminder Frequency Options

| Option | Interval |
|---|---|
| Daily | Every 1 day |
| Every 3 days | Every 3 days |
| Weekly | Every 7 days |
| Every 2 weeks | Every 14 days |
| Monthly | Approximately every 30 days |

The user sets frequency per circle. A Family circle might be set to Weekly while Old Friends might be Monthly.

---

## Home Screen Philosophy

The home screen answers one question:

> Who should I reach out to today?

It is not a dashboard. It is not a statistics screen. It shows one person, one circle, and the relevant actions. Nothing more.

---

## Contact Permission Strategy

### Step 1 — Privacy Explanation (Always First)

Before the OS permission dialog is ever triggered:

```
Your Contacts Stay Private

Stay Close uses your contacts only so you can choose
the people you want to stay connected with.

Your contacts are processed on this device.

They are never uploaded to our servers.

We do not have access to them.

[ Continue ]
```

### Step 2 — OS Permission Request

The OS permission dialog is only triggered after the user taps Continue.

### Step 3 — If Permission Denied

```
Contact access is needed so you can choose the
people you want reminders for.

You can enable it anytime from Settings.

[ Open Settings ]   [ Not Now ]
```

No harassment. One explanation. No repeated badgering.

### Step 4 — If Permission Revoked Later

Handle gracefully. Detect on app resume. Show explanation screen again with option to open Settings or continue without adding new people.

---

## Notification Privacy Strategy

Default: **Private**

Private notification:
```
You have someone to reconnect with.
```

Optional (user-enabled):
```
Maybe reach out to Ahmed today.
```

The setting is called "Notification Privacy" with two states:
- **Private** (default) — No name appears on lock screen
- **Show Person's Name** — Detailed notification with name

---

## Data Retention

- The user explicitly adds people to circles. We store only those selected people.
- We store only: native contact identifier, display name, selected phone number.
- We do not copy the entire address book.
- Reminder history is stored locally only.
- App settings are stored locally only.
- The user can delete all data at any time from within Settings.

---

## Privacy Promise

> Your relationships stay on your phone.

Stay Close uses contact access only so you can choose the people you care about. Your circles, reminders, and relationship information are stored locally on your device. We do not maintain a cloud database of your contacts. We do not sell your data. We do not track your relationships. No account is required. Core functionality works offline.

This promise must be verifiable against the actual implementation before any release.

---

## Success Definition

The product succeeds when a user:

1. Sets it up in under five minutes
2. Receives a reminder
3. Actually contacts that person because of it
4. Feels good — not surveilled, not pressured, not gamified

Success is not measured by:
- Daily active users
- Session length
- Feature count
- Push notification open rate

---

## Non-Goals

These are explicitly out of scope and will not be added without a complete product re-evaluation:

- Any form of social networking
- Any cloud-based user data
- Any advertising business model
- Any analytics platform integration
- Any gamification mechanism
- Any background contact surveillance
- Any communication content access

---

## Platform Targets

- **iOS**: iPhone running iOS 15+
- **Android**: Android 8.0 (API 26)+

Both platforms must be fully supported and tested.

---

## Offline Commitment

The following must work with zero network access:

- Contact selection (after permission granted)
- Circle creation, editing, deletion
- Adding and removing people from circles
- Reminder calculation and scheduling
- Reminder history
- Local notifications
- All settings
- Backup export
- Backup restore
- Data deletion

Network access must never be a hidden dependency for core functionality.
