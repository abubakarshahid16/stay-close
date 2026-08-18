# ADR 006 — SQLite via expo-sqlite

**Status**: Accepted  
**Date**: Phase 0

---

## Context

The application requires persistent local storage for circles, selected people, reminder history, and settings. Several options exist for React Native local storage.

---

## Decision

Use **SQLite via expo-sqlite** as the sole persistent storage mechanism.

---

## Alternatives Considered

**AsyncStorage**: A simple key-value store. Rejected because:
- Not suitable for relational data (circles, people, history relationships)
- No query capability
- No foreign keys or data integrity constraints
- Would require manual indexing and querying in application code

**MMKV**: Fast key-value store. Rejected for same reasons as AsyncStorage — not designed for relational data.

**WatermelonDB**: A reactive SQLite wrapper for React Native. Considered seriously. Rejected because:
- Adds significant complexity and native code
- Larger dependency footprint
- Overhead is unnecessary for Stay Close's data volume and query needs
- expo-sqlite is sufficient

**Realm**: Rejected because:
- Historically had cloud sync as a primary use case (Realm Sync / Atlas Device Sync) which conflicts with local-only architecture
- Larger native dependency

**expo-sqlite**: Selected because:
- Direct SQLite access — the most fundamental and reliable local storage option
- Maintained by Expo — aligned with the rest of the stack
- No native code beyond what Expo manages
- Full SQL capability: foreign keys, indexes, transactions, parameterised queries
- We control the schema completely
- Well understood, well documented, extensively used

---

## Consequences

- We write SQL directly — repository layer provides type-safe wrappers
- Schema migrations must be manually managed (via versioned migration files)
- Testing requires real SQLite behaviour — expo-sqlite must be set up for the test environment
- Database file lives in app-private storage — safe from other apps
- Database is not encrypted in v1.0 — documented as a known limitation in SECURITY.md
