# Reminder Engine

## Purpose

The reminder engine answers one question:

> Given a circle and its members, who should the user be reminded to contact today?

The engine must be fair, avoid repetition, strongly favour people who have not been suggested recently, and be fully testable with deterministic behaviour.

---

## Design Goals

1. **Fairness** — No eligible person is systematically starved of suggestions
2. **Recency awareness** — People suggested recently are deprioritised
3. **Never-suggested priority** — People who have never been suggested get strong priority
4. **Duplicate prevention** — The same person is not suggested twice in a row when alternatives exist
5. **Testability** — Randomness is injectable; the engine supports deterministic tests
6. **Robustness** — Handles edge cases: one person, deleted people, corrupt data, empty circles

---

## Algorithm: Weighted Selection

The engine uses a **weighted random selection** approach where each eligible person's weight is computed from their suggestion history.

### Weight Calculation

For each person in the circle, compute a weight:

```
weight(person) = base_weight × recency_factor × never_suggested_bonus
```

#### Base Weight

All eligible persons start with `base_weight = 1.0`.

#### Recency Factor

Computed from `days_since_last_suggestion`:

```
days_since = current_date - person.last_suggested_at (in days)
             (∞ if never suggested)

recency_factor = min(days_since / circle_frequency_days, 2.0)
```

This means:
- A person suggested yesterday in a Weekly circle has recency_factor ≈ 0.14 (very low weight)
- A person suggested 7 days ago in a Weekly circle has recency_factor = 1.0 (full weight)
- A person suggested 14 days ago in a Weekly circle has recency_factor = 2.0 (double weight cap)
- A person never suggested has recency_factor = 2.0 (maximum)

#### Never-Suggested Bonus

```
never_suggested_bonus = (person.suggestion_count === 0) ? 3.0 : 1.0
```

People who have never been suggested receive a 3× bonus. This strongly prioritises people the user has never been reminded about. Once suggested once, the bonus drops to 1.0 (recency factor then takes over).

#### Final Weight

```
final_weight = base_weight × recency_factor × never_suggested_bonus
```

Example weights in a weekly circle with 4 people:

| Person | Days Since Suggested | Suggestion Count | Recency Factor | Never-Suggested Bonus | Final Weight |
|---|---|---|---|---|---|
| Alex | Never | 0 | 2.0 | 3.0 | **6.0** |
| Jamie | 1 | 5 | 0.14 | 1.0 | **0.14** |
| Taylor | 7 | 3 | 1.0 | 1.0 | **1.0** |
| Jordan | 14 | 2 | 2.0 | 1.0 | **2.0** |

Total weight = 9.14
Alex probability ≈ 66%, Jordan ≈ 22%, Taylor ≈ 11%, Jamie ≈ 1.5%

---

### Weighted Random Selection

Using the computed weights:

1. Sum all weights → `totalWeight`
2. Generate a random float in `[0, totalWeight)` using the injected random provider
3. Walk through the list, accumulating weights until the random value is exceeded
4. The person at that position is selected

```typescript
function weightedSelect<T>(
  items: Array<{ item: T; weight: number }>,
  random: () => number   // injectable random provider
): T | null {
  if (items.length === 0) return null;

  const totalWeight = items.reduce((sum, x) => sum + x.weight, 0);
  if (totalWeight === 0) return items[0].item; // fallback: all zero weight

  let value = random() * totalWeight;
  for (const { item, weight } of items) {
    value -= weight;
    if (value <= 0) return item;
  }
  return items[items.length - 1].item; // floating-point safety fallback
}
```

---

### Last-Suggested Exclusion

If the circle has more than one eligible person, the person who was most recently suggested is temporarily excluded from the weighted pool. This prevents immediate repeats.

```typescript
function buildCandidatePool(
  people: CirclePerson[],
  lastSuggestedPersonId: number | null
): CirclePerson[] {
  if (people.length <= 1) return people;  // Cannot exclude the only person
  return people.filter(p => p.id !== lastSuggestedPersonId);
}
```

---

## Eligibility

A person is eligible for suggestion if they:

1. Belong to the circle
2. Have not been removed from the circle
3. Are still resolvable via their contact identifier (not necessarily — we suggest them and show "contact unavailable" if needed at display time)

A person is **not** excluded from eligibility solely because they were skipped or replaced — they remain in the pool with their normal weight.

---

## Randomness Abstraction

The engine never calls `Math.random()` directly. It accepts a `RandomProvider`:

```typescript
type RandomProvider = () => number;  // Returns float in [0, 1)

// Production usage
const engine = new ReminderEngine({ random: Math.random });

// Test usage — deterministic, seeded
const seededRandom = createSeededRandom(42);
const engine = new ReminderEngine({ random: seededRandom });
```

The seeded random implementation is a deterministic PRNG (e.g. mulberry32) that produces the same sequence for the same seed. This enables:

- Deterministic tests that verify specific selection outcomes
- Statistical distribution tests that run thousands of selections and verify fairness

---

## Edge Cases

| Scenario | Behaviour |
|---|---|
| Circle has 0 people | Return null — no suggestion |
| Circle has 1 person | Always suggest that person |
| All people have weight 0 | Fallback: select uniformly at random |
| Deleted person's history remains | Does not affect active people's weights |
| Person's suggestion_count is corrupted | Treat as 0 (never suggested) |
| last_suggested_at is malformed | Treat as null (never suggested) |
| All people suggested today | Select with minimum weight (recency_factor ≈ 0) — still select someone |

---

## Someone Else

When the user taps "Someone Else":

1. Record `action = 'replaced'` in reminder_history for the current suggestion
2. Temporarily add the current person's ID to a session-level exclusion list
3. Run the engine again with that exclusion applied
4. Present the new suggestion

The session-level exclusion list prevents the engine from immediately cycling back to the replaced person within the same session. It is cleared when the app is restarted or when the reminder is resolved.

---

## Frequency Mapping

The `circle.reminder_frequency` maps to a number of days for the recency factor calculation:

| Frequency Value | Days |
|---|---|
| daily | 1 |
| every_3_days | 3 |
| weekly | 7 |
| every_2_weeks | 14 |
| monthly | 30 |

---

## Notification Scheduling

The notification schedule is determined per circle:

1. When a circle is created or its frequency changes, a local notification is scheduled
2. The notification fires at a user-friendly time (default: 9:00 AM local time)
3. The notification interval matches the circle's frequency

When the notification fires:
- The engine selects a person from that circle
- The notification content references the circle (and optionally the person's name, based on privacy settings)
- On opening the app from the notification, the suggestion is shown on the home screen

See NOTIFICATIONS.md for scheduling details.

---

## Reminder Engine Testing Requirements

The engine must have comprehensive test coverage at multiple levels.

### Unit Tests

- Empty circle → null
- Single person → always returned
- Never-suggested person gets high weight vs. recently-suggested person
- Two people — last-suggested exclusion works
- Weight calculation for each recency scenario
- Never-suggested bonus applied correctly
- Someone Else exclusion prevents repeat within session
- Seeded random produces deterministic output
- Malformed last_suggested_at handled as null
- Malformed suggestion_count handled as 0

### Statistical / Distribution Tests (Seeded)

Using a seeded random provider, run 1,000+ selections and verify:

- Every eligible person was selected at least N times (no starvation)
- Never-suggested people are selected first when available
- Recently-suggested people appear far less often than long-overdue people
- Frequency is proportional to weights within acceptable bounds

These tests use fixed seeds and deterministic bounds — they never flake.

### Integration Tests

- Engine + real SQLite — verify that `last_suggested_at` and `suggestion_count` updates are reflected in subsequent selections
- Engine over multiple days (mocked time) — verify recency factor changes correctly

See TESTING.md for implementation guidance.

---

## Future Considerations

The following are explicitly NOT in scope for v1.0 but may be considered later:

- **Circle-wide scheduling**: If a circle has many people, interleave them across reminder periods rather than picking one per period
- **Manual priority**: Let the user temporarily boost a specific person ("I really should call Mum this week")
- **Time-of-day preference**: Remember which time of day the user prefers notifications per circle
- **Date awareness**: Birthday-based suggestions (would require reading birthday fields — requires new permission scope and privacy review)

None of these will be added without a full product evaluation confirming they serve the single product problem.
