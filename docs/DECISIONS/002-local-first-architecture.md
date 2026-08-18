# ADR 002 — Local-First Architecture

**Status**: Accepted  
**Date**: Phase 0

---

## Context

Mobile apps typically use a client-server architecture where user data is stored in a cloud database. This enables cross-device sync but introduces privacy risks, internet dependency, infrastructure costs, and complexity.

---

## Decision

Stay Close is a **local-first application**. All user data lives exclusively on the user's device.

- SQLite is the only database
- There is no backend server
- There is no cloud database
- Core features work in Airplane Mode
- No network connection is required for any core functionality

---

## Alternatives Considered

**Firebase / Firestore**: Rejected. Introduces cloud data storage, vendor lock-in, network dependency, and conflicts with the privacy promise. Firebase Analytics would also need to be explicitly excluded from the default Firebase package, creating ongoing risk.

**Supabase**: Rejected. Same reasons as Firebase — cloud database.

**Custom backend**: Rejected. Requires server infrastructure, maintenance, security hardening, and creates a central store of sensitive relationship data.

**Local-first with optional sync**: Rejected for v1.0. Optional sync still requires a backend. It complicates the architecture, the privacy promise, and the trust model. If cross-device sync is ever needed, it must be re-evaluated with a complete privacy and security review.

---

## Consequences

- No infrastructure to maintain or pay for
- Privacy promise is technically simple to verify — no network requests happen
- Core functionality works indefinitely, even without network
- No data migration if backend changes
- No cross-device sync in v1.0 — users who switch devices must use the backup/restore feature
- No remote data recovery if user loses device without a backup
- Android manifest can explicitly omit INTERNET permission, providing OS-level enforcement of the no-network contract
