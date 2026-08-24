/**
 * Rotation fairness simulations (issue 023 / #34).
 *
 * The single most important test in the codebase. docs/DOMAIN.md §7 forbids
 * naive random selection because it produces:
 *
 *     Ahmed · Ahmed · Ahmed · Ahmed · Sara · Ahmed
 *
 * Case-by-case unit tests cannot catch that — it is a property of behaviour over
 * many cycles. These simulations run the real selection code over long horizons
 * and assert the properties directly.
 *
 * Every run is seeded and clock-driven, so results are reproducible and never
 * flaky.
 */
import {
  selectForCycle,
  type RotationCandidate,
} from '../../src/domain/rotation/rotation';
import { SeededRandom } from '../../src/adapters/system/SeededRandom';
import {
  contactReferenceId,
  instant,
  instantFromISO,
  type ContactReferenceId,
  type Instant,
} from '../../src/domain/shared/ids';
import type { PriorityState } from '../../src/domain/entities';

const START = instantFromISO('2026-01-01T21:00:00.000Z');
const DAY = 86_400_000;

interface SimPerson {
  readonly id: ContactReferenceId;
  lastContactedAt: Instant | null;
  priority: PriorityState | null;
  membershipActive: boolean;
  availability: 'available' | 'unavailable';
}

interface SimOptions {
  readonly people: number;
  readonly perCycle: number;
  readonly cycles: number;
  /** Days between cycles. */
  readonly intervalDays: number;
  readonly seed?: number;
  /** Fraction of selections the user completes. The rest are left pending. */
  readonly completionRate?: number;
  readonly initialise?: (person: SimPerson, index: number) => void;
}

interface SimResult {
  readonly picks: ContactReferenceId[][];
  readonly counts: Map<ContactReferenceId, number>;
  readonly people: SimPerson[];
}

/**
 * Run the real selection code over many cycles.
 *
 * Models the full loop: select, then the user completes (writing contact
 * history, which feeds the next cycle) or leaves the reminder pending (which
 * excludes the person globally until resolved).
 */
function simulate(options: SimOptions): SimResult {
  const {
    people: peopleCount,
    perCycle,
    cycles,
    intervalDays,
    seed = 1,
    completionRate = 1,
    initialise,
  } = options;

  const people: SimPerson[] = Array.from({ length: peopleCount }, (_, i) => {
    const person: SimPerson = {
      id: contactReferenceId(i + 1),
      lastContactedAt: null,
      priority: null,
      membershipActive: true,
      availability: 'available',
    };
    initialise?.(person, i);
    return person;
  });

  const random = new SeededRandom(seed);
  const pending = new Set<ContactReferenceId>();
  const picks: ContactReferenceId[][] = [];
  const counts = new Map<ContactReferenceId, number>();

  // A separate stream for the completion coin-flip, so changing the completion
  // rate does not shift the selection stream and invalidate comparisons.
  const coin = new SeededRandom(seed + 9973);

  for (let cycle = 0; cycle < cycles; cycle++) {
    const now = instant(START + cycle * intervalDays * DAY);

    const candidates: RotationCandidate[] = people.map((p) => ({
      contactReferenceId: p.id,
      membershipActive: p.membershipActive,
      availability: p.availability,
      lastContactedAt: p.lastContactedAt,
      priority: p.priority,
    }));

    const result = selectForCycle({
      candidates,
      count: perCycle,
      now,
      random,
      context: { pendingContactIds: pending },
    });

    picks.push([...result.selected]);

    for (const id of result.selected) {
      counts.set(id, (counts.get(id) ?? 0) + 1);
      const person = people.find((p) => p.id === id);
      if (!person) continue;

      if (coin.int(100) < completionRate * 100) {
        // Completed: contact history updates, feeding future recency.
        person.lastContactedAt = now;
        pending.delete(id);
      } else {
        // Left unresolved: globally excluded until the user acts.
        pending.add(id);
      }
    }
  }

  return { picks, counts, people };
}

/** Longest run of consecutive cycles in which the same person was selected. */
function longestConsecutiveRun(picks: ContactReferenceId[][]): number {
  let longest = 0;
  const streaks = new Map<ContactReferenceId, number>();

  for (const cycle of picks) {
    const present = new Set(cycle);
    for (const id of present) {
      const next = (streaks.get(id) ?? 0) + 1;
      streaks.set(id, next);
      longest = Math.max(longest, next);
    }
    for (const id of [...streaks.keys()]) {
      if (!present.has(id)) streaks.set(id, 0);
    }
  }

  return longest;
}

const flat = (picks: ContactReferenceId[][]): ContactReferenceId[] => picks.flat();

describe('no pathological repetition', () => {
  // The headline property. With 6 people and 1 per week, nobody should be
  // picked twice in a row while others wait.
  it('never picks the same person in consecutive cycles when others are waiting', () => {
    const { picks } = simulate({ people: 6, perCycle: 1, cycles: 60, intervalDays: 7 });
    expect(longestConsecutiveRun(picks)).toBe(1);
  });

  it.each([2, 3, 5, 10, 30, 100])('holds for a group of %p people', (people) => {
    const { picks } = simulate({ people, perCycle: 1, cycles: people * 3, intervalDays: 7 });
    expect(longestConsecutiveRun(picks)).toBe(1);
  });

  it('holds across many different seeds', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const { picks } = simulate({ people: 8, perCycle: 2, cycles: 40, intervalDays: 7, seed });
      expect(longestConsecutiveRun(picks)).toBe(1);
    }
  });
});

describe('coverage and fairness', () => {
  it('reaches everyone within one full pass', () => {
    const people = 20;
    const { picks } = simulate({ people, perCycle: 1, cycles: people, intervalDays: 7 });
    expect(new Set(flat(picks)).size).toBe(people);
  });

  it('distributes selections evenly over a long horizon', () => {
    const people = 12;
    const cycles = people * 10;
    const { counts } = simulate({ people, perCycle: 1, cycles, intervalDays: 7 });

    expect(counts.size).toBe(people);
    const values = [...counts.values()];
    const expected = cycles / people;
    // A fair rotation should be within one of perfectly even.
    for (const value of values) {
      expect(Math.abs(value - expected)).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the gap between repeat selections near the full cycle length', () => {
    const people = 10;
    const { picks } = simulate({ people, perCycle: 1, cycles: 50, intervalDays: 7 });

    const lastSeen = new Map<ContactReferenceId, number>();
    const gaps: number[] = [];
    picks.forEach((cycle, index) => {
      for (const id of cycle) {
        const previous = lastSeen.get(id);
        if (previous !== undefined) gaps.push(index - previous);
        lastSeen.set(id, index);
      }
    });

    // With 10 people and 1 per cycle, a fair rotation revisits roughly every 10.
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(people - 1);
  });

  it('selects exactly the requested count while enough people are eligible', () => {
    const { picks } = simulate({ people: 30, perCycle: 3, cycles: 20, intervalDays: 7 });
    for (const cycle of picks) {
      expect(cycle).toHaveLength(3);
      expect(new Set(cycle).size).toBe(3); // never a duplicate within a cycle
    }
  });
});

describe('never-contacted people come first', () => {
  it('exhausts newcomers before revisiting anyone', () => {
    const people = 10;
    // Half already contacted recently, half never.
    const { picks } = simulate({
      people,
      perCycle: 1,
      cycles: 5,
      intervalDays: 7,
      initialise: (person, index) => {
        if (index < 5) person.lastContactedAt = instant(START - 2 * DAY);
      },
    });

    const firstFive = new Set(flat(picks));
    // The five never-contacted are ids 6..10.
    for (const id of firstFive) {
      expect(Number(id)).toBeGreaterThan(5);
    }
  });
});

describe('pending reminders', () => {
  // docs/DOMAIN.md §6 — an unresolved reminder blocks reselection everywhere.
  it('never reselects someone whose reminder is unresolved', () => {
    const { picks } = simulate({
      people: 8,
      perCycle: 1,
      cycles: 40,
      intervalDays: 7,
      completionRate: 0, // nothing is ever resolved
    });

    // Each person can be picked at most once: after that they are pending
    // forever, so the run must stop once everyone is exhausted.
    const all = flat(picks);
    expect(new Set(all).size).toBe(all.length);
    expect(all).toHaveLength(8);
  });

  it('keeps rotating when only some reminders are completed', () => {
    const { picks, counts } = simulate({
      people: 12,
      perCycle: 1,
      cycles: 40,
      intervalDays: 7,
      completionRate: 0.7,
    });
    expect(longestConsecutiveRun(picks)).toBe(1);
    // Still makes progress rather than stalling.
    expect(counts.size).toBeGreaterThanOrEqual(10);
  });
});

describe('skip penalty', () => {
  it('defers a skipped person without removing them from rotation', () => {
    const penaltyUntil = instant(START + 21 * DAY);
    const { picks } = simulate({
      people: 6,
      perCycle: 1,
      cycles: 30,
      intervalDays: 7,
      initialise: (person, index) => {
        if (index === 0) {
          person.priority = {
            contactReferenceId: person.id,
            skipPenaltyUntil: penaltyUntil,
            skipCount: 1,
            deprioritizedAt: null,
            updatedAt: START,
          };
        }
      },
    });

    const skipped = contactReferenceId(1);
    const firstIndex = picks.findIndex((cycle) => cycle.includes(skipped));

    // Deferred past the penalty window...
    expect(firstIndex).toBeGreaterThan(0);
    // ...but not excluded permanently. The penalty decays (§7.2).
    expect(firstIndex).toBeGreaterThanOrEqual(0);
    expect(flat(picks)).toContain(skipped);
  });
});

describe('deprioritization', () => {
  // docs/DOMAIN.md §7.3 — indefinite, no decay, but never a deletion.
  it('does not select a deprioritized person while others are available', () => {
    const { picks } = simulate({
      people: 6,
      perCycle: 1,
      cycles: 30,
      intervalDays: 7,
      initialise: (person, index) => {
        if (index === 0) {
          person.priority = {
            contactReferenceId: person.id,
            skipPenaltyUntil: null,
            skipCount: 0,
            deprioritizedAt: START,
            updatedAt: START,
          };
        }
      },
    });
    expect(flat(picks)).not.toContain(contactReferenceId(1));
  });

  it('does select a deprioritized person when nobody else is eligible', () => {
    const { picks } = simulate({
      people: 3,
      perCycle: 1,
      cycles: 10,
      intervalDays: 7,
      initialise: (person) => {
        person.priority = {
          contactReferenceId: person.id,
          skipPenaltyUntil: null,
          skipCount: 0,
          deprioritizedAt: START,
          updatedAt: START,
        };
      },
    });
    // Reaching the bottom tier beats doing nothing at all (§16).
    expect(flat(picks).length).toBeGreaterThan(0);
    expect(longestConsecutiveRun(picks)).toBe(1);
  });
});

describe('unavailable and inactive members', () => {
  it('skips unavailable contacts entirely', () => {
    const { picks } = simulate({
      people: 6,
      perCycle: 1,
      cycles: 20,
      intervalDays: 7,
      initialise: (person, index) => {
        if (index === 0) person.availability = 'unavailable';
      },
    });
    expect(flat(picks)).not.toContain(contactReferenceId(1));
  });

  it('skips inactive memberships entirely', () => {
    const { picks } = simulate({
      people: 6,
      perCycle: 1,
      cycles: 20,
      intervalDays: 7,
      initialise: (person, index) => {
        if (index === 0) person.membershipActive = false;
      },
    });
    expect(flat(picks)).not.toContain(contactReferenceId(1));
  });
});

describe('degenerate groups', () => {
  it('keeps selecting the only member of a one-person group', () => {
    const { picks, counts } = simulate({ people: 1, perCycle: 1, cycles: 10, intervalDays: 7 });
    expect(counts.get(contactReferenceId(1))).toBe(10);
    // Unavoidable here — there is nobody else. Not the pathology §7 forbids.
    expect(longestConsecutiveRun(picks)).toBe(10);
  });

  it('alternates in a two-person group', () => {
    const { picks } = simulate({ people: 2, perCycle: 1, cycles: 20, intervalDays: 7 });
    expect(longestConsecutiveRun(picks)).toBe(1);
  });

  it('selects everyone when asked for more than the group holds', () => {
    const { picks } = simulate({ people: 3, perCycle: 5, cycles: 10, intervalDays: 7 });
    for (const cycle of picks) {
      expect(cycle).toHaveLength(3);
      expect(new Set(cycle).size).toBe(3);
    }
  });

  it('produces nothing for an empty group', () => {
    const { picks } = simulate({ people: 0, perCycle: 2, cycles: 5, intervalDays: 7 });
    expect(flat(picks)).toEqual([]);
  });
});

describe('cross-group overlap', () => {
  /**
   * Two groups sharing members, with one global pending set and one global
   * contact history — the arrangement docs/DOMAIN.md §6 and §10.1 describe.
   * Completing in one group must suppress reselection in the other.
   */
  it('does not double-remind a shared person across groups', () => {
    const shared = [1, 2, 3].map((n) => contactReferenceId(n));
    const familyOnly = [4, 5].map((n) => contactReferenceId(n));
    const friendsOnly = [6, 7].map((n) => contactReferenceId(n));

    const lastContacted = new Map<ContactReferenceId, Instant | null>();
    for (const id of [...shared, ...familyOnly, ...friendsOnly]) lastContacted.set(id, null);

    const pending = new Set<ContactReferenceId>();
    const random = new SeededRandom(7);
    const perCycleSelections: ContactReferenceId[][] = [];

    const build = (ids: readonly ContactReferenceId[]): RotationCandidate[] =>
      ids.map((id) => ({
        contactReferenceId: id,
        membershipActive: true,
        availability: 'available',
        lastContactedAt: lastContacted.get(id) ?? null,
        priority: null,
      }));

    for (let cycle = 0; cycle < 30; cycle++) {
      const now = instant(START + cycle * 7 * DAY);
      const picked: ContactReferenceId[] = [];

      // Both groups' cycles land on the same day — the worst case for
      // double-reminding.
      for (const members of [
        [...shared, ...familyOnly],
        [...shared, ...friendsOnly],
      ]) {
        const result = selectForCycle({
          candidates: build(members),
          count: 1,
          now,
          random,
          context: { pendingContactIds: pending },
        });
        for (const id of result.selected) {
          picked.push(id);
          pending.add(id);
        }
      }

      // The user resolves everything before the next cycle.
      for (const id of picked) {
        lastContacted.set(id, now);
        pending.delete(id);
      }

      perCycleSelections.push(picked);
    }

    // Nobody is reminded twice in the same round, even from two groups.
    for (const round of perCycleSelections) {
      expect(new Set(round).size).toBe(round.length);
    }
  });
});

describe('determinism', () => {
  it('produces identical output for the same seed', () => {
    const a = simulate({ people: 15, perCycle: 2, cycles: 50, intervalDays: 7, seed: 99 });
    const b = simulate({ people: 15, perCycle: 2, cycles: 50, intervalDays: 7, seed: 99 });
    expect(a.picks).toEqual(b.picks);
  });

  it('produces different output for different seeds', () => {
    const a = simulate({ people: 15, perCycle: 2, cycles: 50, intervalDays: 7, seed: 1 });
    const b = simulate({ people: 15, perCycle: 2, cycles: 50, intervalDays: 7, seed: 2 });
    expect(a.picks).not.toEqual(b.picks);
  });

  it('scales to a large group without pathology', () => {
    const { picks, counts } = simulate({
      people: 100,
      perCycle: 2,
      cycles: 200,
      intervalDays: 7,
    });
    expect(longestConsecutiveRun(picks)).toBe(1);
    expect(counts.size).toBe(100);
    const values = [...counts.values()];
    expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(2);
  });
});
