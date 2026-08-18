# ADR 001 — Single-Problem Product

**Status**: Accepted  
**Date**: Phase 0

---

## Context

Product teams frequently add features to increase engagement, satisfy stakeholder requests, or match competitors. The risk is a product that solves many problems averagely rather than one problem exceptionally well.

Stay Close was conceived specifically to solve a single, clearly defined problem: **people forget to reconnect with people they care about.**

---

## Decision

Stay Close solves exactly one problem. Every feature decision is evaluated against:

> Does this directly help the user remember and reconnect with someone they care about?

If the answer is NO, it is not built.

The following are explicitly outside scope, permanently:

- Social feeds
- User profiles
- In-app messaging
- AI coaching
- Relationship scores
- Gamification (streaks, badges, achievements)
- Analytics or behavioural tracking
- Cloud sync
- Call/message monitoring

---

## Alternatives Considered

**Build a comprehensive relationship management tool**: Rejected. Breadth dilutes the core value proposition and introduces privacy complexity.

**Build a social network with reminders**: Rejected. Violates privacy principles and shifts the product's purpose.

**Add AI to analyse relationship health**: Rejected. Introduces surveillance, cloud dependency, and feature creep.

---

## Consequences

- Development is constrained but focused
- The product remains small enough to be maintained with high quality
- User experience is simple and clear
- Privacy architecture remains straightforward
- Every future feature request must pass the single-problem test
- Marketing must accurately represent what the product does and does not do
