/**
 * Random port.
 *
 * Rotation randomises *within* a priority tier (docs/DOMAIN.md §7.1). Fairness
 * has to be asserted deterministically, so tests inject a seeded PRNG and
 * production injects an unseeded one. This is what keeps the fairness suite
 * from being flaky.
 *
 * No domain or application code may call Math.random() directly.
 */

export interface Random {
  /**
   * A uniformly distributed integer in [0, maxExclusive).
   * Returns 0 when maxExclusive <= 1.
   */
  int(maxExclusive: number): number;

  /**
   * A new array containing the same items in randomised order.
   * Must not mutate the input.
   */
  shuffle<T>(items: readonly T[]): T[];
}
