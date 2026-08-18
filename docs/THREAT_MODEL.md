# Threat Model

## Overview

This document describes the privacy and security threat model for Stay Close. Because the application is local-only with no network communications and no backend, many traditional application threats do not apply. The primary threats relate to local data exposure, malicious input, and supply chain risks.

---

## Threat Actors

### 1. Malicious Third-Party Dependency

**Description**: A dependency included in the app is compromised or contains hidden malicious code that exfiltrates contact data.

**Likelihood**: Low-Medium (supply chain attacks are increasingly common)

**Impact**: High — contact names, phone numbers, and relationship information could be transmitted to a third party without the user's knowledge.

**Mitigations**:
- Strict dependency evaluation before install
- `npm audit` in CI
- Minimal dependency footprint
- No dependencies that require network access
- Android manifest does not declare INTERNET permission (strongest mitigation)
- INTERNET permission absence means the OS will block any network calls even if a library attempts them

---

### 2. Malicious Backup File

**Description**: A user imports a crafted backup file designed to crash the app, corrupt the database, or inject unexpected data.

**Likelihood**: Low (user must actively import a file)

**Impact**: Medium — could corrupt local data or cause unexpected behaviour

**Mitigations**:
- File size limit enforced before parsing
- JSON parsing in try/catch — malformed JSON is rejected cleanly
- Schema version validation
- Type validation for every field
- Import runs inside a transaction — rollback on any failure
- Existing data is never modified until the import is fully validated

---

### 3. SQL Injection via User Input

**Description**: A user enters a specially crafted string (e.g. a circle name) that, if interpolated into SQL, could alter database queries.

**Likelihood**: Low (local attack, attacker would need physical device access)

**Impact**: Medium — could read or corrupt local database

**Mitigations**:
- All database operations use parameterised queries — mandatory, never concatenation
- Input length limits reduce injection surface
- Tested with SQL injection strings in automated tests

---

### 4. Contact Data Exposure via Logs

**Description**: Development or production logs inadvertently include contact names, phone numbers, or other PII that could be read via log access tools.

**Likelihood**: Low-Medium

**Impact**: Medium — PII exposed to anyone with log access

**Mitigations**:
- Logging policy: no PII in any log output
- Log utility strips or omits PII fields in production
- Automated tests verify no PII appears in log output for key operations
- Code review checks logging in every PR

---

### 5. Screenshot Exposure in Repository

**Description**: A developer accidentally commits a screenshot containing real contact names or phone numbers to the public GitHub repository.

**Likelihood**: Medium (easy human error)

**Impact**: Medium — real personal data exposed publicly

**Mitigations**:
- Written policy: screenshots use fake demo data only
- Demo dataset defined and consistently reused
- PR checklist includes: "No real personal data committed"
- Post-commit verification step in Definition of Done

---

### 6. Backup File Exposure

**Description**: The user's exported backup file is accessed by an unauthorised party (e.g. shared cloud storage, lost device, shared file).

**Likelihood**: Medium — depends on user behaviour

**Impact**: High — backup contains circle names, contact names, phone numbers

**Mitigations**:
- User is warned before export that the file contains personal information
- User is told to store it somewhere private
- The app cannot control what happens to exported files — this limitation is documented honestly

---

### 7. OS Backup Inclusion

**Description**: iOS iCloud backup or Android auto-backup includes the SQLite database file, potentially exposing it if cloud account is compromised.

**Likelihood**: Low-Medium (depends on user's OS backup configuration)

**Impact**: High — full database exposed

**Mitigations**:
- Documented in PRIVACY.md so users are aware
- Future consideration: opt out of OS backup for the database file, or enable SQLite encryption
- Not addressed in v1.0 — documented as a known limitation

---

### 8. Physical Device Access

**Description**: Someone with physical access to the user's unlocked device opens Stay Close and views relationship data.

**Likelihood**: Medium

**Impact**: Medium — relationship circles and reminder history visible

**Mitigations**:
- This is a physical security concern outside the app's control
- The app relies on device-level authentication (Face ID, fingerprint, PIN)
- No additional in-app authentication is added in v1.0 (would conflict with ease-of-use goal)
- Future consideration: optional app-level lock

---

### 9. Developer Accidentally Pushing Contact Data in Tests

**Description**: A developer writes a test using real contact data and commits it to the repository.

**Likelihood**: Low-Medium

**Impact**: Medium — real personal data in a public repository

**Mitigations**:
- Policy: all test data uses fake named contacts
- Test fixtures use a defined fake dataset
- PR checklist: "No real personal data committed"

---

### 10. Expo / React Native Framework Vulnerabilities

**Description**: A vulnerability in the Expo or React Native framework itself exposes the application to attack.

**Likelihood**: Low

**Impact**: Variable

**Mitigations**:
- Keep Expo and React Native updated
- Monitor Expo security advisories
- `npm audit` in CI catches known vulnerabilities in the dependency tree

---

## Non-Threats (Out of Scope)

Because Stay Close has no network communications and no backend:

| Threat | Why Not Applicable |
|---|---|
| Server-side SQL injection | No server, no remote database |
| API authentication bypass | No API |
| Token theft / session hijacking | No tokens, no sessions |
| Man-in-the-middle attack | No network communications |
| Cloud database breach | No cloud database |
| Account takeover | No account system |
| Phishing for credentials | No credentials |
| DDoS | No server to target |

---

## Threat Prioritisation

| Priority | Threat | Status |
|---|---|---|
| High | Malicious backup file import | Mitigated — validation + transaction |
| High | Backup file exposure | Partially mitigated — user warned |
| High | Supply chain / malicious dependency | Mitigated — no INTERNET permission |
| Medium | SQL injection | Mitigated — parameterised queries |
| Medium | Contact data in logs | Mitigated — log policy + tests |
| Medium | Screenshot exposure in repo | Mitigated — policy + fake data |
| Medium | Physical device access | Not mitigated in v1.0 — documented |
| Low | OS backup inclusion | Partially mitigated — documented |
| Low | Real data in tests | Mitigated — policy + fake fixtures |

---

## Threat Model Review

This threat model is reviewed:

1. During Phase 10 (Security & Privacy Hardening)
2. When a new dependency is added
3. When a new permission is added
4. When data storage or transmission behaviour changes
5. Before any public release

---

## Contact for Security Issues

Security issues should be reported as a private GitHub issue or via the project maintainer. Do not create public issues for security vulnerabilities until they are resolved.
