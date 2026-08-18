# Notifications

## Design Principle

Stay Close uses **local notifications only**. There is no push notification backend, no server, no APNs token registration, no FCM token. Notifications are scheduled entirely on the device using `expo-notifications`.

This is not a technical limitation — it is a deliberate privacy choice.

---

## Notification Permission Strategy

### Step 1 — Privacy Explanation

Before the OS notification permission dialog is triggered:

```
Stay Close uses notifications to remind you
when it's time to reconnect with someone.

Reminders are created on your phone.

[ Enable Reminders ]   [ Not Now ]
```

"Not Now" is always available. The user can enable notifications later from Settings.

### Step 2 — OS Permission Request

Only after "Enable Reminders" is tapped does the OS dialog appear.

### Step 3 — Permission Denied

```
Reminders are disabled.

You can enable them anytime from
Settings → Stay Close → Notifications.

[ Open Settings ]   [ OK ]
```

### Step 4 — Permission Revoked

Detected when the app comes to the foreground and checks `expo-notifications.getPermissionsAsync()`. If previously granted and now denied, the settings screen shows notification permission status and an option to open Settings.

---

## Notification Content

### Privacy Mode (Default)

```
Title: Stay Close
Body:  You have someone to reconnect with.
```

No contact name appears. No circle name appears. The user must open the app to see who is suggested.

### Detailed Mode (User-Enabled)

```
Title: Stay Close
Body:  Maybe reach out to [Name] today.
```

Name appears in the notification body. The user explicitly enables this mode.

The user can change this setting at any time in Settings → Notification Privacy.

---

## Notification Actions

Notifications include action buttons where OS support allows:

| Action | Behaviour |
|---|---|
| Open App | Opens Stay Close to the home/suggestion screen |
| Done | (Future consideration) Mark reminder complete without opening app |

In v1.0, tapping the notification opens the app. The Done action via notification is a future consideration.

---

## Scheduling Strategy

### Per-Circle Scheduling

Each circle has one scheduled local notification. The schedule is based on the circle's `reminder_frequency`.

| Frequency | Notification Interval |
|---|---|
| Daily | Every 1 day |
| Every 3 days | Every 3 days |
| Weekly | Every 7 days |
| Every 2 weeks | Every 14 days |
| Monthly | Every 30 days |

### Notification Time

Default delivery time: **9:00 AM in the user's local timezone**.

In v1.0, the delivery time is fixed. A future enhancement may allow per-circle time preference.

### Notification Identifier

Each circle's notification uses a stable identifier:
```
circle-reminder-{circleId}
```

This allows rescheduling or cancellation by circle without affecting other circles.

---

## Scheduling Operations

### Schedule

Called when:
- A circle is created
- A circle's frequency is changed
- Notification permission is granted (for existing circles)
- The app detects a notification is missing for an active circle

```typescript
await NotificationService.scheduleForCircle(circle);
```

### Reschedule

Called when:
- The circle's frequency changes
- The user's local timezone changes (detected on app foreground)

Old notification is cancelled by identifier, new notification is scheduled.

### Cancel

Called when:
- A circle is deleted
- All people are removed from a circle (no one to suggest)
- The user manually disables notifications in Settings

```typescript
await NotificationService.cancelForCircle(circleId);
```

---

## Notification Persistence After Device Restart

**iOS**: Local notifications survive device restart automatically — they are managed by the OS.

**Android**: Local notifications may need to be rescheduled after device restart.

The Android manifest declares:
```xml
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
```

A BroadcastReceiver reschedules active circle notifications on boot. `expo-notifications` handles much of this automatically — behaviour is tested on real hardware.

---

## Handling Multiple Circles

Each circle has its own independent notification schedule. A user with three circles might receive:

- Family reminder every week
- Old Friends reminder every month
- Colleagues reminder every 2 weeks

Each fires independently. Each shows the same generic notification (in private mode), and the app determines which circle to show based on which notification was tapped (notification data includes `circleId`).

---

## App Foreground Handling

When a notification fires while the app is in the foreground:

- `expo-notifications` notificationHandler is configured
- The notification is suppressed from showing as a banner (user is already in the app)
- The app can react to the notification event to refresh the home screen if needed

---

## Notification Data Payload

Each notification carries a minimal data payload:

```json
{
  "circleId": 1
}
```

No contact name, phone number, or sensitive information is in the notification payload beyond the circle ID. This minimises exposure even if the notification payload were somehow accessible.

---

## Edge Cases

| Scenario | Handling |
|---|---|
| Circle has 0 people | Notification is not scheduled; or cancelled if it was scheduled |
| Circle is deleted | Notification is cancelled in the same transaction |
| Permission revoked | Existing scheduled notifications no longer fire; app shows prompt on foreground |
| Timezone change | App detects on foreground; reschedules all notifications |
| DST change | Same as timezone change |
| App not opened after notification | Next notification fires on schedule; previous one has no special handling |
| Notification tapped after circle deleted | App opens gracefully — if circle no longer exists, home screen shows empty state |

---

## Notification Privacy Review Checklist

Before any release:

- [ ] Default notification content contains no contact names
- [ ] Default notification content contains no circle names
- [ ] Notification payload contains only circleId (no PII)
- [ ] Detailed mode explicitly requires user opt-in
- [ ] Permission explanation appears before OS dialog
- [ ] Permission denied state handled gracefully
- [ ] Notifications reschedule correctly on Android after boot
- [ ] Notifications survive app update on iOS
- [ ] Timezone change triggers rescheduling

---

## Testing Strategy

See TESTING.md for the full notification testing plan.

Key test scenarios:

- Permission granted → notifications schedule correctly
- Permission denied → correct UI shown
- Permission revoked after use → detected on foreground
- Circle created → notification scheduled
- Circle frequency changed → notification rescheduled
- Circle deleted → notification cancelled
- Multiple circles → independent schedules
- Private mode → no name in notification content
- Detailed mode → name appears in notification content
- Device restart → notifications restored (Android — manual device test)
- Timezone change → notifications rescheduled
