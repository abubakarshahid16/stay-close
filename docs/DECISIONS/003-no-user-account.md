# ADR 003 — No User Account

**Status**: Accepted  
**Date**: Phase 0

---

## Context

Most mobile apps require users to create an account (email + password, Google Sign-In, Apple Sign-In, etc.). Accounts enable cross-device sync and user identification but require the product to maintain a user database, authentication infrastructure, and privacy obligations around personally identifiable information.

---

## Decision

Stay Close has no account system. There is no:

- Signup
- Login
- Password
- OTP / verification
- Google Sign-In
- Apple Sign-In
- Social login
- User profile
- User identifier

The product does not know who the user is. It only knows the data stored locally on the device.

---

## Alternatives Considered

**Anonymous account for optional backup**: Rejected. Even an anonymous account requires an infrastructure to receive and store data. The backup/restore feature handles data portability without an account.

**Apple Sign-In only (private relay)**: Rejected. Even with email masking, this requires maintaining a user database and authentication infrastructure. Apple Sign-In is also iOS-only and would require a different approach on Android.

**Device-local keychain identifier**: Considered as a way to identify the device without a user account. Rejected — no current feature requires device identification. If needed in the future, this can be added via an ADR.

---

## Consequences

- No authentication infrastructure to build or maintain
- No user database to secure and protect
- No credential leak risk
- No account recovery workflow needed
- Simpler onboarding — no signup friction
- Data is tied to the device, not an identity
- Cross-device sync is not possible (addressed by backup/restore)
- If device is lost without backup, data cannot be recovered from a server
