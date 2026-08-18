# Security

## Security Philosophy

Stay Close's security posture is shaped by its architecture: a local-only application with no network communications and no backend server. The primary attack surfaces are the local database, backup files, third-party dependencies, and input validation. The application has no authentication layer to protect because there is no account system.

Security requirements are reviewed during Phase 10 (Security & Privacy Hardening) and re-checked for every PR that touches data handling, permissions, or dependencies.

---

## Attack Surface

### In Scope

| Surface | Risk | Mitigation |
|---|---|---|
| SQLite database | SQL injection via malformed input | Parameterised queries always |
| Backup file import | Malicious JSON payload | Schema validation before processing |
| Contact data | Exposure via logs or screenshots | No PII in logs; fake data in screenshots |
| Third-party dependencies | Malicious or compromised packages | Dependency evaluation before install |
| Input fields | Oversized or malformed input | Input length limits and sanitisation |
| Temporary files | Sensitive data in temp storage | Minimise temp file use; clean up |

### Out of Scope

Because Stay Close makes no network requests:

- No API authentication vulnerabilities
- No token leakage via network
- No man-in-the-middle attacks
- No server-side injection attacks
- No cloud database exposure
- No account takeover

---

## SQL Injection Prevention

All database operations use parameterised queries. Untrusted values are never concatenated directly into SQL strings.

**Correct approach (always)**:
```typescript
db.runAsync(
  'INSERT INTO circles (name) VALUES (?)',
  [userInput]
);
```

**Prohibited approach (never)**:
```typescript
db.runAsync(`INSERT INTO circles (name) VALUES ('${userInput}')`);
```

Every repository function must use parameterised queries. This is reviewed in every PR touching database code and verified by tests that attempt SQL-injection strings as input values.

---

## Input Validation

All user-supplied input is validated before being written to the database:

| Field | Validation |
|---|---|
| Circle name | Required, max 100 characters, trimmed |
| Contact display name | Read from OS — validated as non-empty string before storing |
| Phone number | Read from OS — stored as-is but length-limited |
| Reminder frequency | Enum — only allowed values accepted |
| Backup file | Schema version checked; required fields validated; size limited |

Input validation is implemented in a centralised `validation.ts` module — not duplicated in each repository or service.

---

## Backup File Security

Backup files are JSON documents that the user imports. A malicious or corrupted file must never:

- Crash the application
- Corrupt existing valid data
- Execute arbitrary code
- Write unexpected values to the database

Validation steps before any import:
1. File size check — reject files above a defined maximum size
2. JSON parse — in a try/catch; reject on parse failure
3. Schema version check — reject unsupported or missing schema version
4. Required field validation — verify all required fields are present and of expected types
5. Data type validation — verify every value matches its expected type before writing
6. Import runs inside a single SQLite transaction — if any step fails, the entire import is rolled back and existing data is preserved

---

## Dependency Security

### Pre-Install Checklist

Before adding any dependency:

1. Check npm audit for known vulnerabilities
2. Verify the package is actively maintained
3. Read the package source or summary for network calls
4. Check if it requires additional OS permissions
5. Verify it does not include analytics or telemetry
6. Document the decision in docs/DECISIONS/ if significant

### Ongoing Audits

- `npm audit` runs as part of CI on every PR
- Dependency review is conducted during Phase 10
- Dependencies with unresolved high/critical vulnerabilities block release

---

## Sensitive Data in Logs

Production builds must not emit:

- Contact names
- Phone numbers
- Contact identifiers
- Circle membership details
- Notification content containing names

Logging strategy:

```typescript
// Production log — acceptable
logger.info('Reminder selection completed');

// Debug log — acceptable in development builds only
logger.debug('Selected person from circle', { circleId, personId });

// Never acceptable in any build
logger.info('Selected Ahmed Khan for circle Family');
```

A logging utility wraps all output and strips PII fields in production mode. Tests verify that no PII appears in log output for key operations.

---

## Screenshot and Development Security

- GitHub screenshots must use only fake demo data
- No real contacts, names, or phone numbers may appear in any committed screenshot
- Demo dataset is defined and reused consistently: Alex Example, Jamie Example, Taylor Example, Jordan Example, Sam Example

Any accidental commit of real personal data is treated as a security incident:
1. Rewrite git history to remove the data
2. Document the incident
3. Notify affected parties if necessary

---

## Local Database Security

- SQLite database lives in the application's private storage directory
- On iOS: not accessible to other apps without device jailbreak
- On Android: not accessible to other apps without device root (API 26+ enforced)
- The database is not encrypted in v1.0 — a future ADR can address this if needed
- Database backups created by the OS (iCloud backup, Android backup) may include the SQLite file — the user is informed of this in the Privacy documentation

### Future Consideration: Database Encryption

SQLite encryption (via SQLCipher or similar) was evaluated. For v1.0 we do not include it because:
- The OS already provides app-sandbox isolation
- Encryption requires a key — where to store the key securely is non-trivial
- Adding a native SQLite extension increases complexity and dependency risk

If encryption is added in a future release, it will be implemented as a separate ADR.

---

## Permission Hygiene

### What We Request

| Permission | Platform | Reason |
|---|---|---|
| READ_CONTACTS | Android | Contact selection |
| Contacts | iOS | Contact selection |
| POST_NOTIFICATIONS | Android 13+ | Local notification scheduling |
| Notifications | iOS | Local notification scheduling |
| RECEIVE_BOOT_COMPLETED | Android | Reschedule notifications after device restart |

### What We Never Request

- WRITE_CONTACTS
- READ_CALL_LOG
- READ_SMS
- ACCESS_FINE_LOCATION
- ACCESS_COARSE_LOCATION
- CAMERA
- MICROPHONE
- INTERNET (Android manifest level — enforced)

---

## Secrets Management

- No API keys
- No server credentials
- No OAuth client secrets
- No backend URLs

There are no secrets to manage because there is no backend.

Development-time secrets (e.g., if a future CI integration requires a token) are stored in GitHub Actions Secrets, never committed to the repository.

`.gitignore` includes:
```
.env
.env.local
.env.production
*.key
*.pem
```

---

## Security Review Process

Security review occurs:

1. **Phase 10** — Full security audit of the complete product
2. **Every PR** — PR template includes Security Impact field
3. **Pre-Release** — Security checklist in RELEASE.md

Security findings are documented as GitHub issues with the `security` label. Critical findings block release.

---

## Threat Model Reference

See [THREAT_MODEL.md](THREAT_MODEL.md) for the full threat analysis including threat actors, threat scenarios, and mitigations.
