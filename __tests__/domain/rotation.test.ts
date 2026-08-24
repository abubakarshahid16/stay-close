/**
 * Rotation tests (issues 019 / #30, 020 / #31, 021 / #32, 022 / #33).
 *
 * The property that matters is stated in docs/DOMAIN.md §7: selection must not
 * produce pathological repetition. That is asserted in the long-horizon
 * simulations in simulation/fairness.test.ts; here the ladder, eligibility and
 * small-group rules are pinned down case by case.
 */
import {
  assessEligibility,
  filterEligible,
  overdueDays,
  rankCandidates,
  selectForCycle,
  tierOf,
  RotationTier,
  type RotationCandidate,
} from '../../src/domain/rotation/rotation';
import { SeededRandom } from '../../src/adapters/system/SeededRandom';
import {
  contactReferenceId,
  instantFromISO,
  type ContactReferenceId,
} from '../../src/domain/shared/ids';

const NOW = instantFromISO('2026-08-16T21:00:00.000Z');
const DAY = 86_400_000;

const id = (n: number): ContactReferenceId => contactReferenceId(n);

function candidate(
  n: number,
  overrides: Partial<RotationCandidate> = {}
): RotationCandidate {
  return {
    contactReferenceId: id(n),
    membershipActive: true,
    availability: 'available',
    lastContactedAt: null,
    priority: null,
    ...overrides,
  };
}

const daysAgo = (days: number) => instantFromISO(new Date(NOW - days * DAY).toISOString());

const noContext = { pendingContactIds: new Set<ContactReferenceId>() };

const seeded = (seed = 1) => new SeededRandom(seed);

describe('eligibility', () => {
  it('accepts an active, available, unpending member', () => {
    expect(assessEligibility(candidate(1), noContext)).toEqual({
      contactReferenceId: id(1),
      eligible: true,
    });
  });

  it.each([
    ['membership_inactive', { membershipActive: false }],
    ['contact_unavailable', { availability: 'unavailable' as const }],
  ])('excludes for %s', (reason, overrides) => {
    const verdict = assessEligibility(candidate(1, overrides), noContext);
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toBe(reason);
  });

  // docs/DOMAIN.md §6 — the exclusion crosses group boundaries by design.
  it('excludes someone pending in another group', () => {
    const verdict = assessEligibility(candidate(1), {
      pendingContactIds: new Set([id(1)]),
    });
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toBe('pending_elsewhere');
  });

  it('excludes someone already selected in this cycle', () => {
    const verdict = assessEligibility(candidate(1), {
      pendingContactIds: new Set(),
      alreadySelected: new Set([id(1)]),
    });
    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toBe('already_selected_this_cycle');
  });

  it('filters a mixed list', () => {
    const list = [
      candidate(1),
      candidate(2, { membershipActive: false }),
      candidate(3, { availability: 'unavailable' }),
      candidate(4),
    ];
    expect(filterEligible(list, { pendingContactIds: new Set([id(4)]) }).map((c) => c.contactReferenceId)).toEqual([id(1)]);
  });
});

describe('tiers', () => {
  it('places an unmarked candidate in the recency tier', () => {
    expect(tierOf(candidate(1), NOW)).toBe(RotationTier.Recency);
  });

  it('places an active skip penalty below normal recency', () => {
    const c = candidate(1, {
      priority: {
        contactReferenceId: id(1),
        skipPenaltyUntil: instantFromISO('2026-08-20T00:00:00.000Z'),
        skipCount: 1,
        deprioritizedAt: null,
        updatedAt: NOW,
      },
    });
    expect(tierOf(c, NOW)).toBe(RotationTier.SkipPenalised);
  });

  // The penalty decays; deprioritization does not (docs/DOMAIN.md §7.2, §7.3).
  it('returns a lapsed skip penalty to normal rotation', () => {
    const c = candidate(1, {
      priority: {
        contactReferenceId: id(1),
        skipPenaltyUntil: instantFromISO('2026-08-10T00:00:00.000Z'),
        skipCount: 3,
        deprioritizedAt: null,
        updatedAt: NOW,
      },
    });
    expect(tierOf(c, NOW)).toBe(RotationTier.Recency);
  });

  it('places deprioritization at the bottom regardless of skip state', () => {
    const c = candidate(1, {
      priority: {
        contactReferenceId: id(1),
        skipPenaltyUntil: instantFromISO('2026-08-20T00:00:00.000Z'),
        skipCount: 2,
        deprioritizedAt: instantFromISO('2026-08-01T00:00:00.000Z'),
        updatedAt: NOW,
      },
    });
    expect(tierOf(c, NOW)).toBe(RotationTier.Deprioritized);
  });
});

describe('overdueDays', () => {
  it('treats never contacted as infinitely overdue', () => {
    expect(overdueDays(candidate(1), NOW)).toBe(Infinity);
  });

  it('counts whole days', () => {
    expect(overdueDays(candidate(1, { lastContactedAt: daysAgo(10) }), NOW)).toBe(10);
    expect(overdueDays(candidate(1, { lastContactedAt: daysAgo(0) }), NOW)).toBe(0);
  });

  // Two people whose last contact falls in the same 24h bucket relative to now
  // are of equal priority; a millisecond ordering the user cannot perceive
  // should not decide who gets picked.
  //
  // Note this buckets ELAPSED days, not calendar days — two contacts 22h apart
  // can still land either side of a boundary. That is deliberate: calendar-day
  // grouping would need a timezone threaded through, and elapsed time is what
  // "overdue" actually means.
  it('quantises to whole elapsed days so near-identical times tie', () => {
    const a = candidate(1, { lastContactedAt: instantFromISO('2026-08-10T22:00:00.000Z') });
    const b = candidate(2, { lastContactedAt: instantFromISO('2026-08-10T23:30:00.000Z') });
    expect(overdueDays(a, NOW)).toBe(5);
    expect(overdueDays(b, NOW)).toBe(5);
  });

  it('separates candidates that fall in different day buckets', () => {
    const a = candidate(1, { lastContactedAt: instantFromISO('2026-08-10T01:00:00.000Z') });
    const b = candidate(2, { lastContactedAt: instantFromISO('2026-08-10T23:00:00.000Z') });
    expect(overdueDays(a, NOW)).toBe(6);
    expect(overdueDays(b, NOW)).toBe(5);
  });

  it('never goes negative for a future timestamp', () => {
    const future = instantFromISO('2026-09-01T00:00:00.000Z');
    expect(overdueDays(candidate(1, { lastContactedAt: future }), NOW)).toBe(0);
  });
});

describe('ranking', () => {
  it('puts never-contacted ahead of everyone', () => {
    const list = [
      candidate(1, { lastContactedAt: daysAgo(100) }),
      candidate(2), // never
      candidate(3, { lastContactedAt: daysAgo(50) }),
    ];
    expect(rankCandidates(list, NOW, seeded())[0].contactReferenceId).toBe(id(2));
  });

  it('orders by longest time since contact', () => {
    const list = [
      candidate(1, { lastContactedAt: daysAgo(3) }),
      candidate(2, { lastContactedAt: daysAgo(30) }),
      candidate(3, { lastContactedAt: daysAgo(10) }),
    ];
    expect(rankCandidates(list, NOW, seeded()).map((c) => c.contactReferenceId)).toEqual([
      id(2),
      id(3),
      id(1),
    ]);
  });

  it('ranks skip-penalised below normal and deprioritized last', () => {
    const penalised = candidate(2, {
      lastContactedAt: daysAgo(365),
      priority: {
        contactReferenceId: id(2),
        skipPenaltyUntil: instantFromISO('2026-08-20T00:00:00.000Z'),
        skipCount: 1,
        deprioritizedAt: null,
        updatedAt: NOW,
      },
    });
    const deprioritized = candidate(3, {
      lastContactedAt: null,
      priority: {
        contactReferenceId: id(3),
        skipPenaltyUntil: null,
        skipCount: 0,
        deprioritizedAt: instantFromISO('2026-08-01T00:00:00.000Z'),
        updatedAt: NOW,
      },
    });
    // Recently contacted, but unmarked — still beats both.
    const normal = candidate(1, { lastContactedAt: daysAgo(1) });

    expect(
      rankCandidates([deprioritized, penalised, normal], NOW, seeded()).map(
        (c) => c.contactReferenceId
      )
    ).toEqual([id(1), id(2), id(3)]);
  });

  it('is reproducible for a fixed seed', () => {
    const list = [1, 2, 3, 4, 5].map((n) => candidate(n));
    const a = rankCandidates(list, NOW, seeded(42)).map((c) => c.contactReferenceId);
    const b = rankCandidates(list, NOW, seeded(42)).map((c) => c.contactReferenceId);
    expect(a).toEqual(b);
  });

  // Guards against alphabetical or insertion-order bias among equals.
  it('varies the order of equal-priority candidates across seeds', () => {
    const list = [1, 2, 3, 4, 5].map((n) => candidate(n));
    const orders = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((seed) =>
        rankCandidates(list, NOW, seeded(seed))
          .map((c) => c.contactReferenceId)
          .join(',')
      )
    );
    expect(orders.size).toBeGreaterThan(1);
  });

  it('does not shuffle across recency boundaries', () => {
    const list = [
      candidate(1, { lastContactedAt: daysAgo(1) }),
      candidate(2, { lastContactedAt: daysAgo(60) }),
    ];
    for (let seed = 0; seed < 30; seed++) {
      expect(rankCandidates(list, NOW, seeded(seed))[0].contactReferenceId).toBe(id(2));
    }
  });
});

describe('selectForCycle', () => {
  it('selects the requested number', () => {
    const list = [1, 2, 3, 4, 5].map((n) => candidate(n, { lastContactedAt: daysAgo(n * 10) }));
    const result = selectForCycle({
      candidates: list,
      count: 2,
      now: NOW,
      random: seeded(),
      context: noContext,
    });
    expect(result.selected).toHaveLength(2);
    expect(result.short).toBe(false);
    // Most overdue first: 5 (50 days) then 4 (40 days).
    expect(result.selected).toEqual([id(5), id(4)]);
  });

  it('never selects the same person twice in one cycle', () => {
    const list = [1, 2, 3].map((n) => candidate(n));
    const result = selectForCycle({
      candidates: list,
      count: 3,
      now: NOW,
      random: seeded(),
      context: noContext,
    });
    expect(new Set(result.selected).size).toBe(3);
  });

  // docs/DOMAIN.md §7.4 — short is correct, not an error.
  it('selects everyone available when asked for more', () => {
    const list = [1, 2, 3].map((n) => candidate(n));
    const result = selectForCycle({
      candidates: list,
      count: 5,
      now: NOW,
      random: seeded(),
      context: noContext,
    });
    expect(result.selected).toHaveLength(3);
    expect(result.short).toBe(true);
  });

  it('selects the single member of a one-person group', () => {
    const result = selectForCycle({
      candidates: [candidate(1)],
      count: 3,
      now: NOW,
      random: seeded(),
      context: noContext,
    });
    expect(result.selected).toEqual([id(1)]);
  });

  it('selects nobody from an empty group without erroring', () => {
    const result = selectForCycle({
      candidates: [],
      count: 2,
      now: NOW,
      random: seeded(),
      context: noContext,
    });
    expect(result.selected).toEqual([]);
    expect(result.eligibleCount).toBe(0);
  });

  it('selects nobody when everyone is pending elsewhere', () => {
    const list = [1, 2, 3].map((n) => candidate(n));
    const result = selectForCycle({
      candidates: list,
      count: 2,
      now: NOW,
      random: seeded(),
      context: { pendingContactIds: new Set([id(1), id(2), id(3)]) },
    });
    expect(result.selected).toEqual([]);
    expect(result.eligibleCount).toBe(0);
  });

  // docs/DOMAIN.md §16 — better to reach into the bottom tier than do nothing.
  it('falls back to deprioritized members when nobody else is eligible', () => {
    const list = [1, 2].map((n) =>
      candidate(n, {
        priority: {
          contactReferenceId: id(n),
          skipPenaltyUntil: null,
          skipCount: 0,
          deprioritizedAt: instantFromISO('2026-08-01T00:00:00.000Z'),
          updatedAt: NOW,
        },
      })
    );
    const result = selectForCycle({
      candidates: list,
      count: 1,
      now: NOW,
      random: seeded(),
      context: noContext,
    });
    expect(result.selected).toHaveLength(1);
  });

  it('prefers a normal member over a deprioritized one', () => {
    const normal = candidate(1, { lastContactedAt: daysAgo(1) });
    const deprioritized = candidate(2, {
      lastContactedAt: null,
      priority: {
        contactReferenceId: id(2),
        skipPenaltyUntil: null,
        skipCount: 0,
        deprioritizedAt: instantFromISO('2026-08-01T00:00:00.000Z'),
        updatedAt: NOW,
      },
    });
    const result = selectForCycle({
      candidates: [deprioritized, normal],
      count: 1,
      now: NOW,
      random: seeded(),
      context: noContext,
    });
    expect(result.selected).toEqual([id(1)]);
  });

  it.each([0, -1])('selects nobody for a count of %p', (count) => {
    const result = selectForCycle({
      candidates: [candidate(1)],
      count,
      now: NOW,
      random: seeded(),
      context: noContext,
    });
    expect(result.selected).toEqual([]);
  });

  it('excludes people already picked earlier in the same cycle', () => {
    const list = [1, 2, 3].map((n) => candidate(n, { lastContactedAt: daysAgo(n * 10) }));
    const result = selectForCycle({
      candidates: list,
      count: 2,
      now: NOW,
      random: seeded(),
      context: { pendingContactIds: new Set(), alreadySelected: new Set([id(3)]) },
    });
    expect(result.selected).not.toContain(id(3));
    expect(result.selected).toHaveLength(2);
  });
});
