/**
 * Eligibility and fair randomized rotation (issues 019 / #30, 020 / #31,
 * 021 / #32, 022 / #33).
 *
 * This is the heart of the product. Naive random selection is forbidden — it
 * produces `Ahmed · Ahmed · Ahmed · Sara · Ahmed`, which is exactly the
 * experience the app exists to prevent (docs/DOMAIN.md §7).
 *
 * The design is a **tiered ladder with randomisation inside each tier**:
 *
 *   1. never contacted
 *   2. longest time since last contact
 *   3. previously skipped (penalty still active)
 *   4. recently contacted
 *   5. explicitly deprioritized
 *
 * Tiers 1, 2 and 4 are the same dimension — recency — so they collapse into one
 * ordering keyed on whole days since last contact, with `never` treated as
 * infinitely overdue. Skip penalty and deprioritization are separate tiers that
 * dominate recency, because they express an explicit user intention rather than
 * a measurement.
 *
 * Randomisation happens only *within* equal priority (same whole day since
 * contact). That keeps selection fair and reproducible while avoiding the
 * mechanical feel of strict alphabetical or insertion order.
 *
 * Pure: no clock, no I/O. Time and randomness arrive as arguments.
 */
import type { ContactAvailability, PriorityState } from '../entities';
import type { ContactReferenceId, Instant } from '../shared/ids';
import type { Random } from '../../ports/Random';

const MS_PER_DAY = 86_400_000;

/** A group member as rotation sees it, with everything needed to rank them. */
export interface RotationCandidate {
  readonly contactReferenceId: ContactReferenceId;
  readonly membershipActive: boolean;
  readonly availability: ContactAvailability;
  /** Null means never contacted — the top of the ladder. */
  readonly lastContactedAt: Instant | null;
  readonly priority: PriorityState | null;
}

export interface EligibilityContext {
  /**
   * Everyone with an unresolved reminder, from ANY group. Deliberately global:
   * a person belongs to one relationship, not to a group (docs/DOMAIN.md §6).
   */
  readonly pendingContactIds: ReadonlySet<ContactReferenceId>;
  /** Selected earlier in this same cycle. No duplicates within a cycle (§7.4). */
  readonly alreadySelected?: ReadonlySet<ContactReferenceId>;
}

export type IneligibleReason =
  | 'membership_inactive'
  | 'contact_unavailable'
  | 'pending_elsewhere'
  | 'already_selected_this_cycle';

export interface EligibilityVerdict {
  readonly contactReferenceId: ContactReferenceId;
  readonly eligible: boolean;
  readonly reason?: IneligibleReason;
}

/**
 * Why a candidate is or is not eligible. Returned rather than filtered so the
 * caller can explain an empty cycle instead of silently producing nothing.
 */
export function assessEligibility(
  candidate: RotationCandidate,
  context: EligibilityContext
): EligibilityVerdict {
  const id = candidate.contactReferenceId;

  if (!candidate.membershipActive) {
    return { contactReferenceId: id, eligible: false, reason: 'membership_inactive' };
  }
  if (candidate.availability !== 'available') {
    return { contactReferenceId: id, eligible: false, reason: 'contact_unavailable' };
  }
  if (context.pendingContactIds.has(id)) {
    return { contactReferenceId: id, eligible: false, reason: 'pending_elsewhere' };
  }
  if (context.alreadySelected?.has(id)) {
    return { contactReferenceId: id, eligible: false, reason: 'already_selected_this_cycle' };
  }

  return { contactReferenceId: id, eligible: true };
}

export function filterEligible(
  candidates: readonly RotationCandidate[],
  context: EligibilityContext
): RotationCandidate[] {
  return candidates.filter((c) => assessEligibility(c, context).eligible);
}

// ── tiers ───────────────────────────────────────────────────────────────────

/** Lower number selects first. */
export enum RotationTier {
  Recency = 0,
  SkipPenalised = 1,
  Deprioritized = 2,
}

export function tierOf(candidate: RotationCandidate, now: Instant): RotationTier {
  const priority = candidate.priority;
  if (!priority) return RotationTier.Recency;

  // Deprioritization has no decay and outranks everything (docs/DOMAIN.md §7.3).
  if (priority.deprioritizedAt !== null) return RotationTier.Deprioritized;

  // A skip penalty is temporary; once it lapses the person returns to normal
  // rotation with no residue (§7.2).
  if (priority.skipPenaltyUntil !== null && priority.skipPenaltyUntil > now) {
    return RotationTier.SkipPenalised;
  }

  return RotationTier.Recency;
}

/**
 * Whole days since last contact, or Infinity for never contacted.
 *
 * Quantised to days on purpose: two people last contacted a few hours apart are
 * of equal priority, and should be randomised between rather than ordered by a
 * millisecond difference the user cannot perceive.
 */
export function overdueDays(candidate: RotationCandidate, now: Instant): number {
  if (candidate.lastContactedAt === null) return Infinity;
  const elapsed = now - candidate.lastContactedAt;
  return Math.floor(Math.max(elapsed, 0) / MS_PER_DAY);
}

// ── selection ───────────────────────────────────────────────────────────────

export interface SelectionInput {
  readonly candidates: readonly RotationCandidate[];
  readonly count: number;
  readonly now: Instant;
  readonly random: Random;
  readonly context: EligibilityContext;
}

export interface SelectionResult {
  readonly selected: readonly ContactReferenceId[];
  /** True when fewer than `count` were available (docs/DOMAIN.md §7.4). */
  readonly short: boolean;
  readonly eligibleCount: number;
}

/**
 * Select up to `count` people for one cycle.
 *
 * Selecting fewer than asked is correct, not an error: members may be pending
 * elsewhere or unavailable. Selecting zero is also correct for an empty or
 * fully-pending group.
 */
export function selectForCycle(input: SelectionInput): SelectionResult {
  const { candidates, count, now, random, context } = input;

  if (count < 1) return { selected: [], short: false, eligibleCount: 0 };

  const eligible = filterEligible(candidates, context);
  if (eligible.length === 0) {
    return { selected: [], short: count > 0, eligibleCount: 0 };
  }

  const ordered = rankCandidates(eligible, now, random);
  const selected = ordered.slice(0, count).map((c) => c.contactReferenceId);

  return {
    selected,
    short: selected.length < count,
    eligibleCount: eligible.length,
  };
}

/**
 * Full ordering, most-deserving first. Exposed for the fairness simulations and
 * for explaining a choice; callers normally use selectForCycle.
 */
export function rankCandidates(
  candidates: readonly RotationCandidate[],
  now: Instant,
  random: Random
): RotationCandidate[] {
  const byTier = new Map<RotationTier, RotationCandidate[]>();
  for (const candidate of candidates) {
    const tier = tierOf(candidate, now);
    const bucket = byTier.get(tier);
    if (bucket) bucket.push(candidate);
    else byTier.set(tier, [candidate]);
  }

  const out: RotationCandidate[] = [];
  const tiers = [RotationTier.Recency, RotationTier.SkipPenalised, RotationTier.Deprioritized];

  for (const tier of tiers) {
    const bucket = byTier.get(tier);
    if (!bucket || bucket.length === 0) continue;
    out.push(...orderByOverdue(bucket, now, random));
  }

  return out;
}

/**
 * Within a tier: most overdue first, with people of equal overdue-days shuffled
 * between each other.
 */
function orderByOverdue(
  bucket: readonly RotationCandidate[],
  now: Instant,
  random: Random
): RotationCandidate[] {
  const groups = new Map<number, RotationCandidate[]>();
  for (const candidate of bucket) {
    const days = overdueDays(candidate, now);
    const existing = groups.get(days);
    if (existing) existing.push(candidate);
    else groups.set(days, [candidate]);
  }

  // Descending: Infinity (never contacted) first, then longest-ago.
  const keys = [...groups.keys()].sort((a, b) => b - a);

  const out: RotationCandidate[] = [];
  for (const key of keys) {
    const group = groups.get(key) as RotationCandidate[];
    // Shuffle even a single-element group so the Random stream advances
    // identically regardless of grouping — keeps seeded runs reproducible.
    out.push(...random.shuffle(group));
  }
  return out;
}
