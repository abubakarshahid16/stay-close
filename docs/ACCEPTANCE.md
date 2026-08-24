# Functional V1 Acceptance Review

> **Issue:** `057 [Test] Functional V1 end-to-end acceptance` (#68)
> **Reviewed:** `feat/functional-v1`, 549 tests across 22 suites, 11 consecutive green CI runs.

---

## Verdict: **not accepted**

Functional V1 is **not** complete, and the reason is specific and unambiguous: two of the seven
success criteria in `docs/PRODUCT.md` §9 require running the app on physical iOS and Android
hardware, and that has not been done.

Everything that can be established without a device has been established. Nothing is
outstanding for want of implementation. What is missing is *evidence*, and it is the kind that
only a phone can produce.

This document exists so that gap is a stated conclusion rather than an omission somebody
discovers later.

---

## 1. Against the §9 criteria

| # | Criterion | Status |
|---|---|---|
| 1 | Every M1–M9 issue closed | **Partial** — 54 of 58 done; 2 need hardware, 2 are this review and the Phase B roadmap |
| 2 | Full workflow on a physical iOS **and** Android device | **Not met** — no devices, and no iOS toolchain on Windows |
| 3 | Full workflow with networking disabled | **Not met** — needs a device in airplane mode |
| 4 | Rotation passes deterministic fairness simulations | **Met** — 28 simulations, §3 |
| 5 | Scheduler proven idempotent | **Met** — enforced by database constraints, §3 |
| 6 | Dependency, network and permission audits passed | **Met statically**, with one caveat — §4 |
| 7 | No aesthetic work done | **Met** — §5 |

Four met, two not met, one partial. Criteria 2 and 3 are the blockers.

---

## 2. What was built

| Milestone | Issues | State |
|---|---|---|
| M1 Foundation | 9 | Complete |
| M2 Contacts & Groups | 6 | Complete |
| M3 Scheduling & Rotation | 11 | Complete |
| M4 Reminders | 6 | Complete |
| M5 Notifications & Communication | 6 | 5 of 6 — `037` needs hardware |
| M6 History | 4 | Complete |
| M7 Reliability | 4 | Complete |
| M8 Security & Privacy | 3 | Complete (static) |
| M9 Functional V1 | 8 | 6 of 8 — `054`, `055` need hardware |
| M10 UI/UX roadmap | 1 | Complete — deferred by design |

**41 source files. 549 tests. Zero type errors. Zero lint errors.**

Every domain rule in `docs/DOMAIN.md` has a corresponding implementation and test. The
19-row normative edge-case table in §16 has a coverage map in
`__tests__/app/edgeCases.test.ts` pointing each row at where it is asserted.

---

## 3. What the evidence actually supports

These are the claims worth trusting, and why.

**Fair rotation.** 28 long-horizon simulations run the real selection code and assert nobody is
picked in consecutive cycles while others wait — across 2, 3, 5, 10, 30 and 100-person groups and
25 seeds; selections stay within 1 of perfectly even over 120 cycles; never-contacted people are
exhausted before anyone is revisited. This is the product's central promise and it is the
best-evidenced part of the system.

**Scheduler idempotence.** Guaranteed by two independent database constraints rather than
application checks, so two concurrent runs cannot both win. Tested by running the scheduler
repeatedly and asserting one reminder per person per cycle.

**History durability.** Reminder and contact history survive group deletion, membership removal,
schedule changes and native-contact deletion, each asserted directly. A wrong `CASCADE` here
would silently destroy user data and nothing else would notice.

**Nothing is inferred.** Only explicit completion writes contact history. Skip, snooze,
deprioritize and cancel each have a test asserting `lastContactedAt` stays null — without which
rotation weighting would drift invisibly.

**No network.** Enforced by a source scan on every CI run, not merely asserted. The guard also
verifies itself.

---

## 4. What the evidence does not support

Being precise here matters more than the summary above.

**The audits are static.** They prove *our* code makes no network requests and requests three
permissions. They cannot prove a *dependency* stays silent — only on-device traffic inspection
can (`docs/DEVICE_VERIFICATION.md` §8).

**The permission strip is untested against a real build.** The allowlist plugin's transform is
tested; that it applied to a generated `AndroidManifest.xml` is not. `DEVICE_VERIFICATION.md` §1
treats a surviving `INTERNET` or `WRITE_CONTACTS` as a release blocker.

**Notification delivery is entirely unverified.** Whether a reminder actually arrives with the app
force-quit is the single most important unknown, because the whole architecture assumes the OS
delivers pre-registered notifications with no app code running.

**Hermes `Intl` timezone support is unverified, and this one is a launch blocker.** Every cycle
time is computed through `Intl.DateTimeFormat` with a named `timeZone`. Hermes on Android has
historically shipped trimmed ICU, where that can silently fall back to the device zone. It would
not crash — it would compute every cycle in the wrong zone, which looks plausible and is easy to
miss. `docs/PLATFORM.md` §3.1 has a one-line check; run it first.

**Screens do not exist.** There is a placeholder home screen and nothing else. The functional core
is complete and tested, but a user cannot currently create a group or resolve a reminder through
a UI. Phase A permits basic controls; those still have to be built before device verification is
even possible.

---

## 5. Phase discipline held

No colours, typography, animation, iconography, illustration or visual polish was produced.
`app/` contains two files totalling under 60 lines, using default styling.

This was checked rather than assumed: the `app/` directory is small enough to read in full, and
the lint rules prevent screens from acquiring domain logic even as they grow.

---

## 6. What must happen next, in order

1. **Run the Hermes `Intl` check** (`docs/PLATFORM.md` §3.1). It is one line and it gates
   everything else. A failure is a scope decision, not a bug fix.
2. **Build the Phase A screens.** Basic lists, buttons and forms sufficient to exercise the
   workflow — groups, member selection, schedule config, the reminder list, and the four
   resolution actions. Without these, criteria 2 and 3 cannot be attempted.
3. **Produce a development build** and confirm the permission strip applied.
4. **Work through `docs/DEVICE_VERIFICATION.md`** on both platforms, §3.4 (force-quit delivery)
   first.
5. **Re-run this review.** Criteria 2 and 3 should then be answerable with evidence.

Step 2 is the largest remaining piece of work and is not represented by any open issue — the
backlog assumed screens would emerge alongside each feature. They did not, because the
functional layers were built first. That is worth an issue of its own.

---

## 7. Honest summary

The engine is built and well-tested. The scheduling, rotation, reminder-lifecycle and history
logic are the parts most likely to contain subtle bugs, and they are the parts with the strongest
evidence behind them.

What has not been demonstrated is that this works as an app on a phone. That is not a small
remaining formality — it is where the platform assumptions in `docs/PLATFORM.md` get tested for
the first time, and any one of them failing would change the design rather than just the code.

Functional V1 should not be declared complete until §6 is done.
