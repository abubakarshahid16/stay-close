# Stay Close Domain Specification

## Contact Reference

A ContactReference represents a person from the native device Contacts database.

The native Contacts app remains the source of truth for contact identity and communication details.
Stay Close stores only the local reference information needed for grouping, reminders, history, and
safe display when a native contact becomes unavailable.

Expected data:

- Local app contact-reference ID.
- Native contact identifier.
- Display name snapshot for history and unavailable-contact display.
- Relevant phone number snapshots only when needed for communication fallback or historical display.
- Availability state for deleted or inaccessible native contacts.

The app must not duplicate the entire native Contacts database.

## Groups

A Group is a user-defined relationship category such as Family, Close Friends, University Friends,
Colleagues, or Old Friends.

A contact can belong to multiple groups. Removing a contact from one group does not remove the
contact from other groups, delete the native contact, or delete global history.

Deleting a group:

- Deletes the group record.
- Removes future group membership relationships.
- Cancels or reconciles future reminders originating from that group where appropriate.
- Preserves native contacts.
- Preserves global contact history.
- Preserves historical reminder records.

## Schedules

A schedule belongs to a group and defines how reminder selection cycles are produced.

Schedule concepts:

- People per cycle: how many contacts should be selected in one cycle.
- Interval: how often a new cycle occurs.
- Eligible days or monthly date where supported.
- Time of day.
- Selection strategy, initially fair randomized rotation.

"2 people every 7 days" means select two eligible people each weekly cycle. It does not mean each
individual person is guaranteed to be contacted every seven days.

Minimum recurrence support:

- Daily.
- Every X days.
- Weekly.
- Every X weeks.
- Every 2 weeks.
- Monthly.
- Every X months if straightforward.

Monthly schedules on the 29th, 30th, or 31st use the last valid day of shorter months. For example,
a schedule set for the 31st runs on February 28 or February 29 in leap years, April 30, June 30,
September 30, and November 30.

## Fair Randomized Rotation

The app must not use naive random selection.

Rotation considers:

- People never contacted.
- Last successful contact time.
- Existing unresolved reminders.
- Skip history.
- Deprioritization state.
- Previous selections.
- Current cycle state.

Default priority:

1. Never contacted.
2. Longest time since confirmed contact.
3. Previously skipped, after temporary cooldown rules.
4. Recently contacted.
5. Explicitly deprioritized.

Within similar priority groups, use deterministic randomization through an injectable random source
or seed so tests do not become flaky.

## Pending Contact Exclusion

By default, a person with an unresolved reminder should not be selected into another reminder,
including through another group. This avoids duplicate pressure on the same person and keeps global
relationship history meaningful.

If every candidate is pending or unavailable, the scheduler should create no duplicate reminder and
should record or expose that no eligible contact was available for the cycle.

## Reminder Lifecycle

A reminder records what the app asked the user to do.

Lifecycle:

```text
Scheduled
  -> Due
  -> Pending
  -> Completed
  -> Snoozed
  -> Skipped
  -> Deprioritized
```

Snooze modifies the current reminder and must not create duplicates. V1 snooze options are:

- 30 minutes.
- 1 hour.
- 3 hours.
- Tomorrow.
- Next scheduled occurrence.

Skip this time means the user does not want to contact the person now, but the person remains in
normal rotation after temporary priority reduction.

Deprioritize means the person remains in the group and history, but future selection priority is
significantly reduced until a later reactivation rule is added.

Completion is always manual. Opening Phone, SMS, WhatsApp, or any external communication app does
not complete a reminder.

## Contact History

Contact history records what the user explicitly confirmed happened.

Contact history is global to the person, not scoped to a group. If Ahmed belongs to Family and
Friends, and the user completes a reminder for Ahmed through Family today, Friends rotation must
treat Ahmed as recently contacted.

Manual contact logging may be added later, but the history layer must support it without fabricating
reminders.

## Reminder History

Reminder history records what the app asked and how the user resolved it.

It should preserve:

- Scheduled time.
- Due time.
- Group origin.
- Contact reference.
- Notification scheduling identity where relevant.
- Completion, snooze, skip, or deprioritization action.
- Resolution time.

Reminder history survives contact removal, group deletion, and schedule changes.

## Contact Synchronization

The app should reflect changes in native Contacts when permission is available:

- Renamed contacts display current names where possible.
- Changed phone numbers are used for future communication actions.
- Deleted contacts are marked unavailable rather than corrupting history.
- Permission loss must not crash the app or destroy history.

## Notifications

Use local notifications only. Do not build server push notifications.

One notification may be scheduled per reminder. Missing a notification does not remove the
underlying reminder task. The app must reconcile local notification state at startup and after
schedule or reminder changes to prevent duplicates.

## Communication Actions

V1 supports launching:

- Phone call.
- WhatsApp.

The app does not inspect or control what happens inside external apps. External app launch failure,
missing phone numbers, or WhatsApp not installed must be handled without crashing.

## Error and Recovery Rules

The app must gracefully handle:

- Contacts permission denied or revoked.
- Notifications permission denied or revoked.
- Deleted native contacts.
- Empty groups.
- One-contact groups.
- More requested people than available contacts.
- All contacts pending.
- All contacts deprioritized.
- Schedule deletion or modification.
- App restart during pending reminders.
- App restart after completion.
- Timezone changes.
- Device reboot.
- Corrupt or unavailable local data without silently deleting user history.
