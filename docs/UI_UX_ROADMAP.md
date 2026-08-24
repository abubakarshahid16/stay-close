# Phase B — UI/UX Roadmap

> **Issue:** `058 [UI] Phase B UI/UX roadmap (do not implement in Functional V1)` (#69)
> **Status:** roadmap only. **Nothing here is to be built yet.**

Phase B begins only after Functional V1 is complete, tested and privacy-audited
(`docs/PRODUCT.md` §6). This document exists so the deferred work is *recorded* rather than
improvised later — and so nobody is tempted to start it early.

---

## 0. An important precondition

There is a distinction worth being precise about, because it is easy to confuse:

**Phase A still needs screens.** `docs/PRODUCT.md` §37 permits basic lists, buttons, forms and
text — enough to exercise the functionality. Those are **not** Phase B, and they are a
prerequisite for device verification (`docs/ACCEPTANCE.md` §6 step 2). They do not exist yet.

Phase B is everything *beyond* that: making it good rather than making it work.

So the sequence is:

```text
functional core (done)  →  basic Phase A screens  →  device verification  →  Phase B
```

Starting Phase B before device verification would mean polishing a design that platform findings
might still invalidate.

---

## 1. Information architecture

Decide before any visual work, because it constrains everything after.

- **What the home screen is.** Today's reminders, or a list of groups? The product is about *who
  to reach out to next*, which argues for reminders-first — but that is a decision to make
  deliberately, not by default.
- Navigation shape: tabs, stack, or a single scrolling surface.
- Where history and the scorecard live. They are secondary; they must not compete with the
  primary action.
- Where group and schedule configuration sits — probably infrequent, and should not occupy prime
  space.

---

## 2. The reminder card

The single most important surface in the app. Everything else is supporting.

Design questions:

- How to present one person without making the app feel like a task manager. It is a nudge about
  a relationship, not a to-do item.
- The four resolutions — Complete, Snooze, Skip, Deprioritize — have deliberately different
  weights (`docs/DOMAIN.md` §7.2, §7.3). Complete is the point; Deprioritize is rare and
  consequential. Giving them equal visual weight would misrepresent the model.
- Making "Complete" feel like an affirmation rather than ticking a box.
- Snooze offers up to five options, and `next_occurrence` is sometimes unavailable
  (`availableSnoozeOptions`). The UI must handle a varying option count.

---

## 3. Overdue without guilt

A real design risk, called out because the naive treatment actively harms the product.

An overdue reminder means "you have not spoken to someone you care about". Rendering that as a
red error badge turns affection into failure, and the likely response is to stop opening the app.

The visual language for overdue should read as *gentle prominence*, not alarm. This deserves
explicit thought rather than reaching for the standard error palette.

---

## 4. Empty and first-run states

The app is empty and useless until a group with members exists, so these states carry real
weight:

- No groups yet — this is effectively onboarding.
- A group with no members.
- No reminders due — should feel like "you are up to date", not like something is broken.
- Everything resolved for now.
- Contacts permission denied, and denied permanently.
- Notifications denied — the app still works, and must say so rather than appear degraded.

---

## 5. Onboarding

Three things need explaining, and only these three:

1. What a group is.
2. That the app picks who to contact, fairly, so the user does not have to.
3. Why it needs contacts, and that they never leave the device.

The privacy point is a genuine differentiator and worth stating plainly. It should not become a
wall of reassurance.

---

## 6. Visual system

Only after §1–§5 are settled: colour, typography, spacing, iconography, elevation, motion.

Constraints already fixed by Phase A:

- Notifications never name the person (`docs/PRODUCT.md` §5) — the lock screen is not a design
  surface we control.
- Contact names come from the address book, so length and script vary wildly. Layouts must
  survive a very long name and a non-Latin one.

---

## 7. Accessibility

Not a polish pass. Screen-reader labels, focus order, dynamic type, contrast, and touch targets
should be part of each screen as it is designed. Retrofitting is what makes accessibility
expensive.

Note that the reminder actions are destructive-ish and irreversible in effect (completion is
final for an occurrence), so they need clear labels rather than icon-only buttons.

---

## 8. Statistics and scorecard

The data layer already computes everything (`src/domain/metrics`): completion rate, streaks,
per-group rates, recency, activity windows, never-contacted counts.

Design cautions:

- `completionRate` is `null` before anything is resolved — "no data" must render differently
  from 0%. Showing a new user 0% would be a lie the data layer deliberately avoids telling.
- A streak is motivating until it breaks. Breaking a long streak should not feel punitive.
- This is a private app with no social comparison. Metrics should serve reflection, not
  gamification.

---

## 9. Explicitly out of scope for Phase B

- Anything requiring a network, an account or a backend.
- Social features, sharing, leaderboards.
- Naming people in notifications.
- Web or PWA.
- Arbitrary date-time snooze selection (`docs/DOMAIN.md` §8.5 fixes the option set).

---

## 10. How to sequence Phase B

1. Information architecture decision (§1) — settle it before drawing anything.
2. The reminder card (§2), including overdue treatment (§3).
3. Empty and first-run states (§4).
4. Group and schedule configuration.
5. Onboarding (§5).
6. Visual system applied across all of it (§6).
7. Accessibility audit (§7) — though §7 argues it should already be done by this point.
8. Statistics (§8), last, because it is the least essential.

Each step should become its own issue when Phase B opens. They are deliberately not created now:
an open issue invites work, and the whole point of this document is that the work waits.
