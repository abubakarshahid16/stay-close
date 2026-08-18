import type { CirclePerson, ReminderFrequency } from '../types/circle';
import { REMINDER_FREQUENCY_DAYS } from '../types/circle';
import { productionRandom } from '../utils/prng';

export type RandomProvider = () => number;

interface WeightedCandidate {
  person: CirclePerson;
  weight: number;
}

export interface ReminderEngineOptions {
  random?: RandomProvider;
}

const NEVER_SUGGESTED_BONUS = 3.0;
const MAX_RECENCY_FACTOR = 2.0;

export class ReminderEngine {
  private random: RandomProvider;

  constructor(options: ReminderEngineOptions = {}) {
    this.random = options.random ?? productionRandom;
  }

  /**
   * Select a person to suggest from a circle.
   *
   * @param people - All eligible people in the circle
   * @param frequency - The circle's reminder frequency
   * @param lastSuggestedPersonId - ID of the most recently suggested person (excluded if alternatives exist)
   * @param sessionExcludedIds - People excluded for this session (from "Someone Else" taps)
   * @param now - Current datetime string (injectable for testing)
   */
  select(
    people: CirclePerson[],
    frequency: ReminderFrequency,
    lastSuggestedPersonId: number | null = null,
    sessionExcludedIds: Set<number> = new Set(),
    now: string = new Date().toISOString()
  ): CirclePerson | null {
    if (people.length === 0) return null;
    if (people.length === 1) return people[0];

    const frequencyDays = REMINDER_FREQUENCY_DAYS[frequency];
    const nowMs = new Date(now).getTime();

    // Build candidate pool — exclude last suggested and session-excluded if alternatives exist
    let candidates = people.filter(
      (p) => !sessionExcludedIds.has(p.id) && p.id !== lastSuggestedPersonId
    );

    // If exclusions removed everyone, fall back to only session exclusion
    if (candidates.length === 0) {
      candidates = people.filter((p) => !sessionExcludedIds.has(p.id));
    }

    // If still empty (everyone session-excluded), use all people
    if (candidates.length === 0) {
      candidates = [...people];
    }

    const weighted = candidates.map((person) => ({
      person,
      weight: this.computeWeight(person, frequencyDays, nowMs),
    }));

    return this.weightedSelect(weighted);
  }

  computeWeight(
    person: CirclePerson,
    frequencyDays: number,
    nowMs: number
  ): number {
    // Never-suggested bonus
    const neverSuggestedBonus =
      person.suggestionCount === 0 ? NEVER_SUGGESTED_BONUS : 1.0;

    // Recency factor
    let recencyFactor: number;
    if (!person.lastSuggestedAt) {
      recencyFactor = MAX_RECENCY_FACTOR;
    } else {
      const lastMs = new Date(person.lastSuggestedAt).getTime();
      if (isNaN(lastMs)) {
        // Malformed date — treat as never suggested
        recencyFactor = MAX_RECENCY_FACTOR;
      } else {
        const daysSince = (nowMs - lastMs) / (1000 * 60 * 60 * 24);
        recencyFactor = Math.min(daysSince / frequencyDays, MAX_RECENCY_FACTOR);
      }
    }

    return 1.0 * recencyFactor * neverSuggestedBonus;
  }

  private weightedSelect(candidates: WeightedCandidate[]): CirclePerson | null {
    if (candidates.length === 0) return null;

    const totalWeight = candidates.reduce((sum, c) => sum + c.weight, 0);

    if (totalWeight <= 0) {
      // All weights are zero — select uniformly
      const idx = Math.floor(this.random() * candidates.length);
      return candidates[idx].person;
    }

    let value = this.random() * totalWeight;
    for (const { person, weight } of candidates) {
      value -= weight;
      if (value <= 0) return person;
    }

    // Floating-point safety fallback
    return candidates[candidates.length - 1].person;
  }
}

export const reminderEngine = new ReminderEngine();
