/**
 * Deterministic Random built on mulberry32.
 *
 * Used by the fairness simulations and every rotation test. A fixed seed makes
 * selection reproducible, which is the difference between an assertable
 * fairness property and a flaky test (docs/ARCHITECTURE.md §4.2).
 *
 * Also usable in production via CryptoRandom, which seeds this from a
 * non-deterministic source.
 */
import type { Random } from '../../ports/Random';

/** mulberry32 — small, fast, well-distributed for our purposes. */
export function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function next(): number {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class SeededRandom implements Random {
  private readonly next: () => number;

  constructor(seed: number) {
    this.next = mulberry32(seed);
  }

  int(maxExclusive: number): number {
    if (!Number.isFinite(maxExclusive) || maxExclusive <= 1) return 0;
    return Math.floor(this.next() * maxExclusive);
  }

  shuffle<T>(items: readonly T[]): T[] {
    // Fisher-Yates. Copies first so the input is never mutated.
    const out = [...items];
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const tmp = out[i];
      out[i] = out[j];
      out[j] = tmp;
    }
    return out;
  }
}
