# ADR 009 — Weighted Reminder Selection Algorithm

**Status**: Accepted  
**Date**: Phase 0

---

## Context

The core technical challenge of Stay Close is: given a circle with multiple people, who should be suggested next? The approach must be fair, avoid repetition, and be fully testable.

---

## Decision

Use a **weighted random selection algorithm** with the following factors:

1. **Never-suggested bonus**: People with suggestion_count === 0 receive a 3× weight multiplier
2. **Recency factor**: Weight increases proportionally to days since last suggestion, capped at 2× for overdue suggestions
3. **Last-suggested exclusion**: The most recently suggested person is excluded from the pool when alternatives exist
4. **Injectable randomness**: The random number generator is a constructor parameter, enabling deterministic tests

See REMINDER_ENGINE.md for the full algorithm specification.

---

## Alternatives Considered

**Pure random (Math.random())**: Rejected.
- Can suggest the same person multiple times in a row
- Does not prioritise people who have never been suggested
- Does not account for recency
- Perceived as unfair by users
- Cannot guarantee all circle members are suggested over time

**Round-robin (strict rotation)**: Considered. Rejected because:
- Too mechanical — user can predict exactly who is next
- No randomness means the experience feels rigid
- Deleted or skipped people break the rotation
- Difficult to handle "Someone Else" without complex state

**Last-in-last-out queue**: Considered. Rejected because:
- Similar to round-robin — predictable
- Requires maintaining ordered state that must survive restarts and deletions

**ML-based personalisation**: Rejected.
- Requires data collection and model training
- Introduces cloud dependency
- Overkill for the problem
- Violates privacy principles (behavioural data collection)

**Weighted selection with recency**: Selected.
- Naturally prioritises overdue and never-suggested people
- Non-predictable but fair
- Handles all edge cases (one person, deletion, skips)
- Statistically testable
- Randomness is injectable — fully deterministic tests are possible

---

## Consequences

- The algorithm must be implemented as a pure function with injectable randomness
- Statistical distribution tests are required to verify fairness
- The algorithm's parameters (3× bonus, 2× cap) are initial values — they may be tuned based on user experience
- Any parameter changes require re-running the statistical test suite
- The algorithm is documented in REMINDER_ENGINE.md and must be updated if the implementation changes
