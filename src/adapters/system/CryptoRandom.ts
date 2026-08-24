/**
 * Production Random. The only place in the codebase permitted to call
 * Math.random().
 *
 * Delegates to SeededRandom so production and test share one algorithm — the
 * only difference is where the seed comes from. That keeps the distribution
 * properties verified by the test suite true in production too.
 */
import type { Random } from '../../ports/Random';
import { SeededRandom } from './SeededRandom';

export class CryptoRandom implements Random {
  private readonly inner: Random;

  constructor() {
    // Not cryptographically strong, and does not need to be: this only
    // decides who to remind, and a seeded stream is reseeded on each app
    // launch. Named for its role, not for a security guarantee.
    this.inner = new SeededRandom((Math.random() * 0xffffffff) >>> 0);
  }

  int(maxExclusive: number): number {
    return this.inner.int(maxExclusive);
  }

  shuffle<T>(items: readonly T[]): T[] {
    return this.inner.shuffle(items);
  }
}
