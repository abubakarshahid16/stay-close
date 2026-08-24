/**
 * Tests for the Clock and Random ports and their adapters (issue 009 / #20).
 *
 * These are the foundation of every later deterministic test, so they are
 * verified directly rather than assumed.
 */
import { SeededRandom, mulberry32 } from '../../src/adapters/system/SeededRandom';
import { CryptoRandom } from '../../src/adapters/system/CryptoRandom';
import { SystemClock } from '../../src/adapters/system/SystemClock';
import { FakeClock } from '../../src/testing/FakeClock';
import { instantFromISO, instantToISO } from '../../src/domain/shared/ids';
import { ok, err, isOk, isErr, unwrap, domainError } from '../../src/domain/shared/Result';

describe('mulberry32', () => {
  it('produces values in [0, 1)', () => {
    const next = mulberry32(12345);
    for (let i = 0; i < 1000; i++) {
      const v = next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('is deterministic for a given seed', () => {
    const a = mulberry32(42);
    const b = mulberry32(42);
    const seqA = Array.from({ length: 50 }, () => a());
    const seqB = Array.from({ length: 50 }, () => b());
    expect(seqA).toEqual(seqB);
  });

  it('produces different streams for different seeds', () => {
    const a = mulberry32(1);
    const b = mulberry32(2);
    expect(a()).not.toEqual(b());
  });
});

describe('SeededRandom', () => {
  it('int() stays within bounds', () => {
    const r = new SeededRandom(7);
    for (let i = 0; i < 500; i++) {
      const v = r.int(10);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(10);
      expect(Number.isInteger(v)).toBe(true);
    }
  });

  // Guards the "small group" rotation path, where the candidate pool can be
  // a single person or empty (docs/DOMAIN.md §7.4).
  it.each([0, 1, -5, NaN, Infinity])('int(%p) returns 0 rather than throwing', (n) => {
    expect(new SeededRandom(7).int(n as number)).toBe(0);
  });

  it('int() is reproducible for the same seed', () => {
    const a = new SeededRandom(99);
    const b = new SeededRandom(99);
    expect(Array.from({ length: 20 }, () => a.int(100))).toEqual(
      Array.from({ length: 20 }, () => b.int(100))
    );
  });

  it('shuffle() does not mutate its input', () => {
    const input = Object.freeze([1, 2, 3, 4, 5]);
    const r = new SeededRandom(3);
    // Would throw on the frozen array if shuffle mutated in place.
    expect(() => r.shuffle(input)).not.toThrow();
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });

  it('shuffle() preserves every element exactly once', () => {
    const input = Array.from({ length: 50 }, (_, i) => i);
    const out = new SeededRandom(5).shuffle(input);
    expect(out).toHaveLength(50);
    expect([...out].sort((x, y) => x - y)).toEqual(input);
  });

  it('shuffle() is reproducible for the same seed', () => {
    const input = Array.from({ length: 30 }, (_, i) => i);
    expect(new SeededRandom(11).shuffle(input)).toEqual(new SeededRandom(11).shuffle(input));
  });

  it('shuffle() actually reorders', () => {
    const input = Array.from({ length: 30 }, (_, i) => i);
    expect(new SeededRandom(11).shuffle(input)).not.toEqual(input);
  });

  it('shuffle() handles empty and single-element arrays', () => {
    const r = new SeededRandom(1);
    expect(r.shuffle([])).toEqual([]);
    expect(r.shuffle(['only'])).toEqual(['only']);
  });

  // A biased shuffle would silently break rotation fairness, so assert the
  // distribution rather than trusting the implementation.
  it('shuffle() distributes a given element across all positions', () => {
    const positions = new Array(5).fill(0);
    for (let seed = 0; seed < 2000; seed++) {
      const out = new SeededRandom(seed).shuffle([0, 1, 2, 3, 4]);
      positions[out.indexOf(0)]++;
    }
    // Uniform would be 400 each; allow generous slack for sampling noise.
    for (const count of positions) {
      expect(count).toBeGreaterThan(250);
      expect(count).toBeLessThan(550);
    }
  });
});

describe('CryptoRandom', () => {
  it('satisfies the Random contract', () => {
    const r = new CryptoRandom();
    const v = r.int(10);
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(10);
    expect([...r.shuffle([1, 2, 3])].sort()).toEqual([1, 2, 3]);
  });
});

describe('FakeClock', () => {
  it('reports the instant it was constructed with', () => {
    const clock = new FakeClock('2026-08-16T21:00:00.000Z');
    expect(instantToISO(clock.now())).toBe('2026-08-16T21:00:00.000Z');
  });

  it('does not advance on its own', () => {
    const clock = new FakeClock('2026-08-16T21:00:00.000Z');
    const first = clock.now();
    expect(clock.now()).toBe(first);
  });

  it('advances by milliseconds and days', () => {
    const clock = new FakeClock('2026-08-16T21:00:00.000Z');
    clock.advance(1000);
    expect(instantToISO(clock.now())).toBe('2026-08-16T21:00:01.000Z');
    clock.advanceDays(7);
    expect(instantToISO(clock.now())).toBe('2026-08-23T21:00:01.000Z');
  });

  // Models a user changing the device clock backwards (docs/DOMAIN.md §13).
  it('accepts negative advance', () => {
    const clock = new FakeClock('2026-08-16T21:00:00.000Z');
    clock.advance(-3600 * 1000);
    expect(instantToISO(clock.now())).toBe('2026-08-16T20:00:00.000Z');
  });

  it('reports and can change timezone', () => {
    const clock = new FakeClock('2026-08-16T21:00:00.000Z', 'Europe/London');
    expect(clock.timeZone()).toBe('Europe/London');
    clock.setTimeZone('Asia/Karachi');
    expect(clock.timeZone()).toBe('Asia/Karachi');
  });

  it('defaults to UTC', () => {
    expect(new FakeClock('2026-08-16T21:00:00.000Z').timeZone()).toBe('UTC');
  });
});

describe('SystemClock', () => {
  it('returns a plausible current instant', () => {
    const before = Date.now();
    const now = new SystemClock().now();
    expect(now).toBeGreaterThanOrEqual(before);
    expect(now).toBeLessThanOrEqual(Date.now());
  });

  it('returns a non-empty timezone', () => {
    expect(new SystemClock().timeZone().length).toBeGreaterThan(0);
  });
});

describe('instant conversion', () => {
  it('round-trips ISO strings', () => {
    const iso = '2026-02-28T23:59:59.999Z';
    expect(instantToISO(instantFromISO(iso))).toBe(iso);
  });
});

describe('Result', () => {
  it('narrows ok values', () => {
    const r = ok(42);
    expect(isOk(r)).toBe(true);
    expect(isErr(r)).toBe(false);
    if (isOk(r)) expect(r.value).toBe(42);
  });

  it('narrows error values', () => {
    const e = domainError('INVALID_TRANSITION', 'completed -> pending');
    const r = err(e);
    expect(isErr(r)).toBe(true);
    if (isErr(r)) expect(r.error.code).toBe('INVALID_TRANSITION');
  });

  it('unwrap returns the value for ok', () => {
    expect(unwrap(ok('x'))).toBe('x');
  });

  it('unwrap throws for err', () => {
    expect(() => unwrap(err(domainError('NOT_FOUND', 'group')))).toThrow(/unwrap called on error/);
  });
});
