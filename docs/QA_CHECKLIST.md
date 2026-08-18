# QA Checklist

This checklist is completed manually for each significant release. Mark each item ✅ (pass), ❌ (fail — file a bug), or N/A.

---

## Environment

| Item | Value |
|---|---|
| Tester | |
| Date | |
| App Version | |
| Android Version | |
| iOS Version | |
| Device Models Tested | |

---

## 1. Installation

- [ ] App installs from build without errors on Android
- [ ] App installs from build without errors on iOS
- [ ] App does not request unexpected permissions on install
- [ ] App icon and name are correct

---

## 2. Onboarding (First Launch)

- [ ] Welcome / explanation screen appears on first launch
- [ ] Onboarding does NOT show on subsequent launches
- [ ] Onboarding text is clear and accurate
- [ ] All buttons are tappable with large enough targets
- [ ] Onboarding works correctly when skipped mid-way and restarted

---

## 3. Contact Permission

- [ ] Privacy explanation screen appears BEFORE OS permission dialog
- [ ] Privacy explanation text accurately describes what the app does
- [ ] OS permission dialog appears after tapping Continue
- [ ] Permission granted → contacts load correctly
- [ ] Permission denied → correct explanation shown
- [ ] "Open Settings" button opens OS app settings
- [ ] "Not Now" dismisses without crashing
- [ ] App does not crash if permission is denied
- [ ] App does not repeatedly ask for permission when denied
- [ ] Revoking permission in OS Settings and returning to app is handled gracefully
- [ ] Contact access works offline (Airplane Mode ON)

---

## 4. Contact Selection

- [ ] Contacts list loads correctly after permission granted
- [ ] Search field filters contacts in real time
- [ ] Search with no results shows empty state (not error)
- [ ] Contacts with no phone number are shown (but handled if selected)
- [ ] Contacts with multiple phone numbers prompt number selection
- [ ] Selecting a contact marks it visually
- [ ] Deselecting removes the visual mark
- [ ] Multi-selection works correctly
- [ ] Already-added contacts appear pre-selected
- [ ] Add button shows correct count
- [ ] Add button is disabled when 0 contacts selected
- [ ] Very long contact names do not break the layout
- [ ] Unicode names (Arabic, Chinese, etc.) display correctly
- [ ] Emoji in contact names display correctly

---

## 5. Circles — Create

- [ ] Create circle screen appears correctly
- [ ] Empty name is rejected (cannot submit)
- [ ] Whitespace-only name is rejected
- [ ] Very long name is handled (truncated or rejected gracefully)
- [ ] Reminder frequency options all appear
- [ ] All five frequency options are selectable
- [ ] Circle is saved correctly after creation
- [ ] Circle appears in circles list after creation
- [ ] Circle persists after app is closed and reopened

---

## 6. Circles — Edit

- [ ] Circle name can be edited
- [ ] Reminder frequency can be changed
- [ ] Changes persist after app restart
- [ ] People can be added to an existing circle
- [ ] People can be removed from a circle
- [ ] Removing a person removes them from reminder eligibility
- [ ] Deleting a circle removes it from the list
- [ ] Deleting a circle cancels its notification
- [ ] Empty circle name rejected on edit

---

## 7. Home Screen — Reminder Suggestion

- [ ] Home screen shows a suggested person when a circle has members
- [ ] Suggested person's name is shown
- [ ] Circle name is shown
- [ ] "Done" button marks the reminder complete
- [ ] "Someone Else" shows a different person (not the same person immediately)
- [ ] "Call" opens the device phone app with the correct number
- [ ] "Call" is hidden if person has no phone number
- [ ] After Done, home screen returns to waiting state
- [ ] Empty state shown correctly when no circles exist
- [ ] Empty state shown correctly when circles exist but have no people

---

## 8. Reminder Engine Fairness (Manual Spot Check)

- [ ] Across 10 consecutive reminders in a circle with 4 people, all 4 people are suggested at least once
- [ ] A person who was just suggested is not suggested immediately again when Someone Else is tapped
- [ ] A never-suggested person appears before recently-suggested people

---

## 9. Local Notifications

- [ ] Permission explanation appears before OS dialog
- [ ] Notification permission granted → notification scheduled for circles
- [ ] Notification permission denied → correct message shown
- [ ] Open Settings works from notification denied state
- [ ] Notification fires at approximately the correct time
- [ ] Private mode notification contains no contact name
- [ ] Detailed mode notification contains contact name (after opt-in)
- [ ] Tapping notification opens app to suggestion screen
- [ ] Notification is cancelled when circle is deleted
- [ ] Notification reschedules when circle frequency changes
- [ ] Notifications survive app restart (iOS)
- [ ] Notifications reschedule after device restart (Android — manual)
- [ ] Timezone change triggers rescheduling
- [ ] App in foreground: notification suppressed from banner

---

## 10. Settings

- [ ] Settings screen is reachable from main navigation
- [ ] Notification Privacy toggle works (Private ↔ Show Name)
- [ ] Setting persists after app restart
- [ ] "Back Up My Data" export works
- [ ] "Restore Backup" import works
- [ ] "Delete All My Data" requires confirmation
- [ ] Delete data removes all circles and people
- [ ] Delete data cancels all scheduled notifications
- [ ] After delete, app shows empty/onboarding state

---

## 11. Backup and Restore

- [ ] Export creates a file
- [ ] Warning about file containing personal information is shown before export
- [ ] Exported file can be shared to Files / Drive / etc.
- [ ] Importing a valid backup restores circles
- [ ] Importing a valid backup restores people in circles
- [ ] Importing a malformed file shows error (does not crash)
- [ ] Import failure preserves existing data (no corruption)
- [ ] Restore after fresh install works correctly
- [ ] Backup works offline (Airplane Mode ON)
- [ ] Restore works offline (Airplane Mode ON)

---

## 12. Offline (Airplane Mode)

Enable Airplane Mode before these tests.

- [ ] App opens normally in Airplane Mode
- [ ] Contacts load (after permission previously granted)
- [ ] Circle creation works
- [ ] Circle editing works
- [ ] Reminder suggestion works
- [ ] Done action works
- [ ] Someone Else works
- [ ] Backup export works
- [ ] Backup import works
- [ ] Settings changes work
- [ ] Notification scheduling works

---

## 13. Data Persistence

- [ ] Circles persist across app close and open
- [ ] People in circles persist across app close and open
- [ ] Reminder history persists across app close and open
- [ ] Settings persist across app close and open
- [ ] Data persists after device restart
- [ ] Data is not lost after app update

---

## 14. Accessibility

- [ ] All buttons have accessible labels (screen reader announces them correctly)
- [ ] Screen reader (VoiceOver / TalkBack) can navigate the onboarding flow
- [ ] Screen reader can navigate the contact selection screen
- [ ] Screen reader can navigate the circle management screen
- [ ] Screen reader can navigate the home / suggestion screen
- [ ] Large text (Accessibility → Larger Text) does not break layouts
- [ ] High contrast mode renders correctly
- [ ] All interactive elements have minimum 44×44pt tap target
- [ ] No action depends exclusively on color differentiation
- [ ] Focus order is logical throughout the app

---

## 15. Edge Cases

- [ ] User with 0 circles — app handles gracefully
- [ ] User with circles but 0 people in each — app handles gracefully
- [ ] User with 1 person in a circle — always suggests that person
- [ ] Very long circle name — does not break layout
- [ ] Contact deleted from OS while app is running — handled gracefully
- [ ] Circle with a deleted contact — shows "contact unavailable" state correctly
- [ ] App opened from background (not from notification) shows correct state
- [ ] Multiple circles with different frequencies — each operates independently

---

## 16. Privacy Spot Check

- [ ] With a network proxy / Charles: no outbound HTTP requests during normal use
- [ ] Notification in private mode contains no name
- [ ] No contact names appear in the crash log or system log during normal use
- [ ] Android manifest does not declare INTERNET permission
- [ ] iOS Info.plist does not include unexpected usage keys

---

## 17. Performance

- [ ] App opens in under 2 seconds on a mid-range device
- [ ] Contact list with 500 contacts loads and is scrollable without jank
- [ ] Circle creation is responsive
- [ ] Switching between tabs/screens is smooth
- [ ] No UI thread blocking during database operations

---

## 18. Final Sign-Off

| Tester | Result | Notes |
|---|---|---|
| | PASS / FAIL / CONDITIONAL | |

All ❌ items must have filed GitHub issues before release.
Critical failures block release.
