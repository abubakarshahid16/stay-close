import { createSeededRandom } from '../../src/utils/prng';

describe('createSeededRandom', () => {
  it('returns values in [0, 1)', () => {
    const rng = createSeededRandom(42);
    for (let i = 0; i < 1000; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('produces deterministic output for the same seed', () => {
    const rng1 = createSeededRandom(1337);
    const rng2 = createSeededRandom(1337);
    for (let i = 0; i < 100; i++) {
      expect(rng1()).toBe(rng2());
    }
  });

  it('produces different sequences for different seeds', () => {
    const rng1 = createSeededRandom(1);
    const rng2 = createSeededRandom(2);
    const values1 = Array.from({ length: 10 }, () => rng1());
    const values2 = Array.from({ length: 10 }, () => rng2());
    expect(values1).not.toEqual(values2);
  });

  it('sequences do not repeat early (basic period check)', () => {
    const rng = createSeededRandom(999);
    const values = new Set<number>();
    for (let i = 0; i < 100; i++) {
      values.add(rng());
    }
    // Should produce many distinct values — not cycling early
    expect(values.size).toBeGreaterThan(90);
  });
});
