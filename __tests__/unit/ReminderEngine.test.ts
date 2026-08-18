import { ReminderEngine } from '../../src/services/ReminderEngine';
import { createSeededRandom } from '../../src/utils/prng';
import type { CirclePerson } from '../../src/types/circle';

// Helper to build a CirclePerson for tests — uses fake data only
function makePerson(
  overrides: Partial<CirclePerson> & { id: number; displayName: string }
): CirclePerson {
  return {
    id: overrides.id,
    circleId: 1,
    contactIdentifier: `fake-id-${overrides.id}`,
    displayName: overrides.displayName,
    phoneNumber: null,
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
    lastSuggestedAt: overrides.lastSuggestedAt ?? null,
    suggestionCount: overrides.suggestionCount ?? 0,
    ...overrides,
  };
}

const NOW = '2024-06-01T09:00:00.000Z';
const WEEKLY_FREQ = 'weekly' as const;
const seeded = (seed: number) => new ReminderEngine({ random: createSeededRandom(seed) });

describe('ReminderEngine', () => {
  describe('edge cases', () => {
    it('returns null for empty people array', () => {
      const engine = seeded(1);
      expect(engine.select([], WEEKLY_FREQ, null, new Set(), NOW)).toBeNull();
    });

    it('always returns the only person in a single-person circle', () => {
      const engine = seeded(1);
      const person = makePerson({ id: 1, displayName: 'Alex Example' });
      expect(engine.select([person], WEEKLY_FREQ, null, new Set(), NOW)).toEqual(person);
    });

    it('returns the only person even if they are the last suggested', () => {
      const engine = seeded(1);
      const person = makePerson({
        id: 1,
        displayName: 'Alex Example',
        lastSuggestedAt: NOW,
        suggestionCount: 5,
      });
      expect(engine.select([person], WEEKLY_FREQ, 1, new Set(), NOW)).toEqual(person);
    });

    it('returns the only person even when they are session-excluded', () => {
      const engine = seeded(1);
      const person = makePerson({ id: 1, displayName: 'Alex Example' });
      expect(engine.select([person], WEEKLY_FREQ, null, new Set([1]), NOW)).toEqual(person);
    });
  });

  describe('never-suggested priority', () => {
    it('strongly prefers never-suggested person over recently-suggested person', () => {
      const neverSuggested = makePerson({
        id: 1,
        displayName: 'Alex Example',
        lastSuggestedAt: null,
        suggestionCount: 0,
      });
      const recentlySuggested = makePerson({
        id: 2,
        displayName: 'Jamie Example',
        lastSuggestedAt: NOW, // suggested right now
        suggestionCount: 10,
      });

      // Run 100 selections with seeded random — count how often never-suggested appears
      let neverCount = 0;
      for (let i = 0; i < 100; i++) {
        const e = new ReminderEngine({ random: createSeededRandom(i) });
        const result = e.select(
          [neverSuggested, recentlySuggested],
          WEEKLY_FREQ,
          null,
          new Set(),
          NOW
        );
        if (result?.id === 1) neverCount++;
      }

      // Never-suggested person should appear in the vast majority of selections
      expect(neverCount).toBeGreaterThan(80);
    });

    it('applies 3x never-suggested bonus', () => {
      const engine = new ReminderEngine();
      const neverSuggested = makePerson({ id: 1, displayName: 'Alex Example', suggestionCount: 0 });
      const suggested = makePerson({
        id: 2,
        displayName: 'Jamie Example',
        suggestionCount: 5,
        lastSuggestedAt: '2024-05-01T00:00:00.000Z', // 31 days ago from NOW
      });

      const nowMs = new Date(NOW).getTime();
      const freqDays = 7;

      const w1 = engine.computeWeight(neverSuggested, freqDays, nowMs);
      const w2 = engine.computeWeight(suggested, freqDays, nowMs);

      // never-suggested: recencyFactor=2.0 (capped), bonus=3.0 → weight=6.0
      expect(w1).toBeCloseTo(6.0, 1);
      // suggested 31 days ago with weekly freq: recencyFactor = min(31/7, 2) = 2.0 → weight=2.0
      expect(w2).toBeCloseTo(2.0, 1);
    });
  });

  describe('recency factor', () => {
    it('gives recencyFactor=0 for person suggested right now', () => {
      const engine = new ReminderEngine();
      const person = makePerson({
        id: 1,
        displayName: 'Alex Example',
        lastSuggestedAt: NOW,
        suggestionCount: 1,
      });
      const weight = engine.computeWeight(person, 7, new Date(NOW).getTime());
      expect(weight).toBeCloseTo(0, 2);
    });

    it('gives recencyFactor=1.0 exactly at frequency interval', () => {
      const engine = new ReminderEngine();
      const sevenDaysAgo = '2024-05-25T09:00:00.000Z'; // exactly 7 days before NOW
      const person = makePerson({
        id: 1,
        displayName: 'Alex Example',
        lastSuggestedAt: sevenDaysAgo,
        suggestionCount: 3,
      });
      const weight = engine.computeWeight(person, 7, new Date(NOW).getTime());
      expect(weight).toBeCloseTo(1.0, 2);
    });

    it('caps recencyFactor at 2.0 for very old suggestions', () => {
      const engine = new ReminderEngine();
      const veryOld = '2020-01-01T00:00:00.000Z';
      const person = makePerson({
        id: 1,
        displayName: 'Alex Example',
        lastSuggestedAt: veryOld,
        suggestionCount: 3,
      });
      const weight = engine.computeWeight(person, 7, new Date(NOW).getTime());
      expect(weight).toBeCloseTo(2.0, 2);
    });

    it('treats malformed lastSuggestedAt as never suggested', () => {
      const engine = new ReminderEngine();
      const person = makePerson({
        id: 1,
        displayName: 'Alex Example',
        lastSuggestedAt: 'not-a-date',
        suggestionCount: 0,
      });
      const weight = engine.computeWeight(person, 7, new Date(NOW).getTime());
      // Should get max weight: recencyFactor=2.0 × bonus=3.0 = 6.0
      expect(weight).toBeCloseTo(6.0, 1);
    });

    it('treats malformed lastSuggestedAt with count>0 as max recency', () => {
      const engine = new ReminderEngine();
      const person = makePerson({
        id: 1,
        displayName: 'Alex Example',
        lastSuggestedAt: 'invalid',
        suggestionCount: 5,
      });
      const weight = engine.computeWeight(person, 7, new Date(NOW).getTime());
      // recencyFactor=2.0 (malformed treated as never seen) × bonus=1.0 = 2.0
      expect(weight).toBeCloseTo(2.0, 1);
    });
  });

  describe('last-suggested exclusion', () => {
    it('excludes last suggested person when alternatives exist', () => {
      const last = makePerson({ id: 1, displayName: 'Alex Example' });
      const other = makePerson({ id: 2, displayName: 'Jamie Example' });

      // Run 20 times — should never get person 1
      for (let i = 0; i < 20; i++) {
        const e = new ReminderEngine({ random: createSeededRandom(i) });
        const result = e.select([last, other], WEEKLY_FREQ, 1, new Set(), NOW);
        expect(result?.id).toBe(2);
      }
    });

    it('includes last suggested person when they are the only option', () => {
      const engine = seeded(1);
      const person = makePerson({ id: 1, displayName: 'Alex Example' });
      const result = engine.select([person], WEEKLY_FREQ, 1, new Set(), NOW);
      expect(result?.id).toBe(1);
    });
  });

  describe('session exclusion (Someone Else)', () => {
    it('excludes session-excluded people', () => {
      const p1 = makePerson({ id: 1, displayName: 'Alex Example' });
      const p2 = makePerson({ id: 2, displayName: 'Jamie Example' });
      const p3 = makePerson({ id: 3, displayName: 'Taylor Example' });

      for (let i = 0; i < 10; i++) {
        const e = new ReminderEngine({ random: createSeededRandom(i) });
        const result = e.select(
          [p1, p2, p3],
          WEEKLY_FREQ,
          null,
          new Set([1, 2]),
          NOW
        );
        expect(result?.id).toBe(3);
      }
    });

    it('falls back to all people when everyone is session-excluded', () => {
      const engine = seeded(1);
      const people = [
        makePerson({ id: 1, displayName: 'Alex Example' }),
        makePerson({ id: 2, displayName: 'Jamie Example' }),
      ];
      // Both session-excluded — should still return someone
      const result = engine.select(people, WEEKLY_FREQ, null, new Set([1, 2]), NOW);
      expect(result).not.toBeNull();
    });
  });

  describe('statistical distribution', () => {
    it('distributes suggestions fairly across all circle members', () => {
      const people = [
        makePerson({ id: 1, displayName: 'Alex Example', suggestionCount: 5, lastSuggestedAt: '2024-05-01T00:00:00.000Z' }),
        makePerson({ id: 2, displayName: 'Jamie Example', suggestionCount: 3, lastSuggestedAt: '2024-05-15T00:00:00.000Z' }),
        makePerson({ id: 3, displayName: 'Taylor Example', suggestionCount: 1, lastSuggestedAt: '2024-05-28T00:00:00.000Z' }),
        makePerson({ id: 4, displayName: 'Jordan Example', suggestionCount: 0, lastSuggestedAt: null }),
      ];

      const counts: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0 };
      const RUNS = 2000;

      for (let i = 0; i < RUNS; i++) {
        const e = new ReminderEngine({ random: createSeededRandom(i) });
        const result = e.select(people, WEEKLY_FREQ, null, new Set(), NOW);
        if (result) counts[result.id]++;
      }

      // Person 4 (never suggested) should appear most often
      expect(counts[4]).toBeGreaterThan(counts[1]);
      expect(counts[4]).toBeGreaterThan(counts[2]);
      expect(counts[4]).toBeGreaterThan(counts[3]);

      // No person with eligibility should be starved — every person appears at least once
      expect(counts[1]).toBeGreaterThan(0);
      expect(counts[2]).toBeGreaterThan(0);
      expect(counts[3]).toBeGreaterThan(0);
      expect(counts[4]).toBeGreaterThan(0);
    });

    it('never-suggested person is selected first in most cases when mixed with others', () => {
      const never = makePerson({ id: 1, displayName: 'Alex Example', suggestionCount: 0 });
      const others = Array.from({ length: 5 }, (_, i) =>
        makePerson({
          id: i + 2,
          displayName: `Person ${i + 2} Example`,
          suggestionCount: i + 1,
          lastSuggestedAt: '2024-05-01T00:00:00.000Z',
        })
      );

      let neverCount = 0;
      for (let i = 0; i < 500; i++) {
        const e = new ReminderEngine({ random: createSeededRandom(i * 17) });
        const result = e.select([never, ...others], WEEKLY_FREQ, null, new Set(), NOW);
        if (result?.id === 1) neverCount++;
      }

      // never-suggested weight=6.0, 5 others weight=2.0 each → total=16.0
      // P(never-suggested) = 6/16 = 37.5%. Over 500 runs, expect ~187, floor at 120 for variance
      expect(neverCount).toBeGreaterThan(120);
    });
  });

  describe('determinism', () => {
    it('produces identical results for the same seed', () => {
      const people = [
        makePerson({ id: 1, displayName: 'Alex Example' }),
        makePerson({ id: 2, displayName: 'Jamie Example' }),
        makePerson({ id: 3, displayName: 'Taylor Example' }),
      ];

      const results1: number[] = [];
      const results2: number[] = [];

      for (let i = 0; i < 20; i++) {
        const e1 = new ReminderEngine({ random: createSeededRandom(12345) });
        const e2 = new ReminderEngine({ random: createSeededRandom(12345) });
        results1.push(e1.select(people, WEEKLY_FREQ, null, new Set(), NOW)?.id ?? -1);
        results2.push(e2.select(people, WEEKLY_FREQ, null, new Set(), NOW)?.id ?? -1);
      }

      // Both sequences should be identical (same seed = same results)
      // Note: each engine instance is separate; this tests the seeded PRNG itself
      expect(results1).toEqual(results2);
    });
  });

  describe('all frequencies', () => {
    const frequencies = ['daily', 'every_3_days', 'weekly', 'every_2_weeks', 'monthly'] as const;

    frequencies.forEach((freq) => {
      it(`selects a person with frequency: ${freq}`, () => {
        const engine = seeded(1);
        const people = [
          makePerson({ id: 1, displayName: 'Alex Example' }),
          makePerson({ id: 2, displayName: 'Jamie Example' }),
        ];
        const result = engine.select(people, freq, null, new Set(), NOW);
        expect(result).not.toBeNull();
        expect([1, 2]).toContain(result?.id);
      });
    });
  });
});
