# ADR 010 — Testing Strategy

**Status**: Accepted  
**Date**: Phase 0

---

## Context

This project requires production-quality engineering. Testing is a non-negotiable requirement. The technology stack (React Native, Expo, SQLite) has specific constraints around what can be tested automatically.

---

## Decision

Use a six-level testing strategy:

1. **Unit tests** — Jest, pure business logic functions
2. **Database tests** — Jest with real expo-sqlite, not mocked
3. **Component tests** — React Native Testing Library
4. **Integration tests** — Multiple layers together, real SQLite, mocked OS APIs
5. **E2E tests** — Maestro (decision below) for full user journeys
6. **Manual device QA** — Documented in QA_CHECKLIST.md

### E2E Tool: Maestro (Preferred)

Maestro is selected for E2E testing over Detox because:
- Simpler configuration — no native build changes required
- Works with Expo Go and development builds
- YAML-based test flows are readable and maintainable
- Good cross-platform support (iOS + Android)
- Active maintenance

Detox remains an alternative if Maestro proves insufficient.

### Database Tests: Real SQLite, Not Mocked

Database tests use real expo-sqlite rather than mock databases. This is mandatory because:
- Mock databases do not verify SQL correctness
- Constraint enforcement is SQLite-specific behaviour
- CASCADE DELETE must be tested against real SQLite
- Transaction rollback must be verified in real SQLite
- Parameterised queries must be tested to verify injection prevention

### Randomness: Injectable Provider

The reminder engine uses an injectable random provider. Tests use a seeded deterministic PRNG (mulberry32 or similar). This makes all reminder engine tests deterministic — they never flake due to random number outcomes.

### Test Data: Fake Contacts Only

All test data uses the standardised fake contact dataset. Real contact names and phone numbers are never used in any test file or fixture.

---

## Alternatives Considered

**Detox for E2E**: A strong option. Rejected as primary tool because Maestro is simpler to set up with Expo. May be added if Maestro has gaps.

**Snapshot tests as primary component tests**: Rejected as the primary approach. Snapshots catch unintended changes but do not verify behaviour or accessibility. RNTL interaction tests are required in addition to any snapshots.

**Mocked SQLite for all database tests**: Rejected. Mocked databases give false confidence. Real SQLite behaviour must be tested.

**No E2E tests**: Rejected. Critical user journeys must be automated where possible.

---

## Consequences

- CI must be set up to run unit, database, component, and integration tests
- E2E tests run separately (Maestro requires a running app / simulator)
- E2E setup is documented and repeatable
- Test configuration is maintained as part of the project
- Coverage reporting is included in CI
- Flaky tests must be fixed immediately — they undermine trust in the test suite
- Statistical reminder engine tests use fixed seeds — they never flake
