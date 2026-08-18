# ADR 008 — No Cloud Analytics or Tracking

**Status**: Accepted  
**Date**: Phase 0

---

## Context

Analytics and crash reporting tools are commonly included in mobile apps to understand user behaviour, track errors, and measure product success. All common analytics tools transmit data to external servers.

---

## Decision

Stay Close includes **no analytics or tracking of any kind**.

Specifically excluded:
- Google Analytics
- Firebase Analytics
- Mixpanel
- Amplitude
- Segment
- Meta / Facebook SDK
- Hotjar or FullStory
- Advertising SDKs
- Behavioral tracking
- Device fingerprinting
- Crashlytics / Sentry (versions that transmit data)
- Any crash reporter that sends data over the network

---

## Why

1. **Privacy promise**: The product promises to not transmit user data. Analytics by definition transmits usage data.

2. **Contact data risk**: If analytics were included, there is always a risk of contact names or relationship data leaking into analytics events through developer error.

3. **The product does not need engagement optimization**: We are not trying to maximize screen time, sessions, or retention through data analysis. The product succeeds when users reconnect with people — this happens off our platform.

4. **Trust**: Inclusion of analytics SDKs undermines the trust relationship with users who care about privacy.

5. **No INTERNET permission**: The Android manifest does not declare the INTERNET permission, making network-calling SDKs non-functional at the OS level.

---

## Alternatives Considered

**Privacy-preserving analytics (Plausible, Fathom, self-hosted)**: Rejected. Even privacy-preserving analytics transmit data over the network. The app has no internet permission. No analytics means no analytics.

**Local-only event logging for debugging**: Accepted as a limited measure. Debug logs exist during development. Production builds have minimal, PII-free logging. No log data is transmitted.

**Opt-in crash reporting**: Rejected for v1.0. A crash reporter that works without network is impractical. If crash reporting is added in the future, it must be explicitly opt-in, clearly explained to users, and verified to transmit no PII.

---

## Consequences

- We do not know how many users the app has
- We do not know which features are used
- We do not know about crashes in the wild (unless users report them)
- We cannot A/B test features
- Product decisions are based on user feedback, first principles, and direct user conversations — not usage data
- This is a deliberate trade-off aligned with the product's privacy values
