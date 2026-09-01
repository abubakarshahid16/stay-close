# Stay Close V1 Functional Specification

## Purpose

Stay Close is a private, offline-first relationship-maintenance assistant for iOS and Android. It
helps a user intentionally stay connected with people in their existing phone contacts by organizing
contacts into groups, generating fair reminders, and keeping local history.

The app is useful in airplane mode. Core functionality does not depend on a backend, account,
login, cloud database, server push, analytics, advertising, or telemetry.

## Product Philosophy

Stay Close is not a CRM, social network, cloud address book, messaging platform, communication
platform, server-backed reminder service, or analytics product.

Stay Close is a small personal assistant that answers:

- Who should I contact?
- When should I contact them?
- What reminders are due, pending, or overdue?
- What relationship contact history have I explicitly confirmed?

## Functional Workflow

1. Read native phone contacts after permission is granted.
2. Let the user reference selected contacts locally.
3. Let the user create groups.
4. Let a contact belong to multiple groups.
5. Let each group have a connection schedule.
6. Evaluate schedules locally.
7. Select contacts with fair randomized rotation.
8. Create persistent reminder tasks.
9. Schedule local notifications where supported and permitted.
10. Let the user launch Phone or WhatsApp.
11. Require manual completion; external app launch never completes a reminder.
12. Record reminder history and confirmed contact history locally.
13. Use global contact history to influence future rotation.

## Privacy Requirements

The app must not:

- Require a backend.
- Require an account, login, signup, or server authentication.
- Upload contacts, names, phone numbers, reminder history, relationship history, or user notes.
- Include analytics, telemetry, advertising, or tracking SDKs unless explicitly approved later.
- Require internet connectivity for core workflows.

The app should request only:

- Contacts permission.
- Notifications permission.

Location, camera, microphone, photos, Bluetooth, file, calendar, and account permissions are out of
scope for V1 unless a future issue documents a functional requirement.

## Functional Phase Rule

Phase A is functional product development. It includes foundation, architecture, database, contacts,
groups, schedules, rotation, reminders, notifications, communication actions, history, testing,
recovery, and privacy validation.

Phase A must not include visual styling work: no branding, colors, typography, animation, polish,
illustration, dark mode, decorative dashboards, or aesthetic redesign. Basic functional screens are
allowed only when needed to exercise product behavior.

Phase B, UI/UX, starts only after Functional V1 acceptance passes.

## Platform Direction

Use Expo, React Native, and TypeScript unless a specific native capability cannot be satisfied that
way. Platform-sensitive behavior must be verified against current Expo, iOS, and Android behavior
before implementation.

Capabilities that need explicit verification include:

- Contacts access.
- Local notifications while the app is backgrounded or closed.
- Device reboot notification recovery.
- Permission revocation.
- Phone deep links.
- WhatsApp deep links.
- Expo Go versus development-build limitations.

## Old Product Conflicts

The deleted implementation must not be revived blindly. These conflicts are intentional:

- Use the term Group, not Circle, unless a later architecture decision says otherwise.
- V1 is mobile-first iOS and Android; PWA/web support is not a V1 requirement.
- Do not add JSON backup/restore to V1.
- Do not add a "Someone else" replacement workflow to V1.
- Rotation must be fair randomized and history-aware, not naive random and not based only on old
  weighted `last_suggested_at` behavior.
- Schedules distinguish number of people per cycle from interval.
- Skip this time and deprioritize are separate domain actions.
- Reminder history and contact history are separate.

## Functional V1 Acceptance

Functional V1 is complete only when the app can:

- Install and run on iOS and Android.
- Work without network connectivity for all core workflows.
- Request and handle contacts and notification permissions.
- Reference native contacts without copying the whole address book.
- Create groups and assign contacts to multiple groups.
- Configure schedules for groups.
- Generate fair, non-duplicative reminder selections.
- Persist due, pending, overdue, completed, snoozed, skipped, and deprioritized reminder states.
- Deliver local notifications where the operating system permits.
- Preserve missed reminders as in-app tasks.
- Launch Phone and WhatsApp without assuming completion.
- Record confirmed contact history globally.
- Preserve history after contact removal, group deletion, and schedule changes.
- Recover correctly after app restart.
- Avoid duplicate reminders and duplicate notifications.
- Pass automated, offline, and physical-device validation.
