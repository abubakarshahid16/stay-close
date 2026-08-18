# ADR 005 — Store Only Selected Contacts

**Status**: Accepted  
**Date**: Phase 0

---

## Context

When the app has contact permission, it can read the full address book. The question is whether to: (a) import and store the entire address book locally, or (b) store only the specific contacts the user has added to circles.

---

## Decision

Stay Close stores only the contacts that the user **explicitly adds to a circle**.

What is stored per selected contact:
- Native contact identifier (for sync/refresh)
- Display name (snapshot at time of selection)
- One selected phone number (snapshot at time of selection)

What is NOT stored:
- Contacts not added to any circle
- Email addresses
- Postal addresses
- Contact photos
- Any other contact fields

---

## Alternatives Considered

**Store the entire address book locally**: Rejected.
- Larger attack surface if the local database is accessed
- Violates data minimisation principles
- Unnecessary — we only need to contact information for selected people
- Harder to explain to users what data we hold

**Store contact identifiers only, always look up name/number live**: Rejected.
- Requires contacts permission to be active whenever a reminder is shown
- Reminder functionality would break if permission is later revoked
- Display names and numbers need to be available even when contacts are offline

**Store full contact record for selected contacts**: Rejected.
- More data than needed
- Birthday, notes, address, email — none of these are used by the app

---

## Consequences

- Data minimisation is achieved — we store only what we use
- The privacy promise ("we store only the people you choose") is accurate
- If contact permission is revoked, previously selected people's names and numbers are still available from the local database
- Display name and phone number snapshots may become stale — contact sync mechanism needed
- Contact sync on circle open refreshes name and number from the current OS contact data
