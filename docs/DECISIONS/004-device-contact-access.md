# ADR 004 — Device Contact Access (expo-contacts)

**Status**: Accepted  
**Date**: Phase 0

---

## Context

The user needs to select people they care about. There are two approaches: manual data entry (type name and number) or access to the device's existing contact list.

---

## Decision

Stay Close reads the device's existing contact list via `expo-contacts`. Manual contact entry is not the primary experience.

**Why**:

1. Users already have their contacts on their phone. Manual entry duplicates existing data and creates a worse experience.
2. The existing contact list has correct names and numbers. Manual entry is error-prone.
3. The `expo-contacts` API is a well-maintained Expo SDK with direct OS integration.
4. Contact access is a well-understood OS permission with explicit user consent.

**Privacy constraints applied**:

- Privacy explanation screen appears before the OS permission dialog
- The app reads only: contact identifier, display name, phone numbers
- Only user-selected contacts are stored in SQLite
- The full address book is never imported or stored
- Contact data is never transmitted

---

## Alternatives Considered

**Manual entry only**: Rejected. Significantly worse user experience. Duplicates data that already exists on the device. Creates a barrier to adoption, especially for older users.

**Manual entry with contact access as optional enhancement**: Rejected. Complicates the architecture for a minor benefit. Contact access is the right primary experience.

**Third-party contact management SDK**: Rejected. Introduces an unnecessary dependency that may make network calls or have different privacy characteristics than `expo-contacts`.

---

## Consequences

- Requires OS contact permission (`READ_CONTACTS` on Android, Contacts on iOS)
- Permission explanation UX must be implemented and maintained
- Permission denial and revocation states must be handled
- Contact synchronisation (renamed / deleted contacts) must be handled
- Contact identifiers differ between platforms — normalisation layer required
- Contact data refreshes are local-only operations — no network dependency
