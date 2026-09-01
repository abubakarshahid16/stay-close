# 003 Platform Capability Spike

Status: Accepted for V1 planning

Date: 2026-09-02

Related issue: #14

## Context

Stay Close needs native Contacts access, local notifications, notification recovery, and external
communication links while preserving the product rule: no backend, no accounts, no telemetry, and
core functionality works offline.

This spike verifies current platform capabilities before implementation.

## Sources

- Expo Contacts: https://docs.expo.dev/versions/latest/sdk/contacts/
- Expo Notifications SDK 57: https://docs.expo.dev/versions/v57.0.0/sdk/notifications/
- Expo notification concepts: https://docs.expo.dev/push-notifications/what-you-need-to-know/
- Expo linking into other apps: https://docs.expo.dev/linking/into-other-apps/
- Expo Linking API: https://docs.expo.dev/versions/latest/sdk/linking/
- Expo development builds FAQ: https://docs.expo.dev/develop/development-builds/faq/
- Expo development builds introduction: https://docs.expo.dev/develop/development-builds/introduction/
- React Native Linking: https://reactnative.dev/docs/next/linking
- Apple `canOpenURL`: https://developer.apple.com/documentation/uikit/uiapplication/canopenurl(_:)

## Decision Summary

Use Expo-managed React Native with development builds as the primary V1 validation path.

Expo Go may be used for early exploration where supported, but V1 acceptance depends on development
or production builds on real iOS and Android devices because permissions, native configuration, URL
scheme queries, Android notification channels, and production behavior must match the shipped app.

Do not introduce custom native modules in this spike.

## Contacts

### Current Expo API

Use `expo-contacts`.

Relevant APIs:

- `Contact.getAll()` for reading contacts.
- `Contacts.getPagedContactsAsync()` where paging/querying is needed.
- `Contacts.getPermissionsAsync()`.
- `Contacts.requestPermissionsAsync()`.
- `Contact.presentPicker()` for native contact selection.
- `Contact.presentAccessPicker()` for iOS 18+ selected-contact access.

### iOS Behavior

`expo-contacts` supports iOS and is included in Expo Go. iOS requires an
`NSContactsUsageDescription` permission message. The Expo config plugin can set
`contactsPermission`.

iOS 18+ may return limited contact access through `accessPrivileges`, with values such as `all`,
`limited`, or `none`. The app must treat limited access as a valid but constrained permission mode.

The contact `note` field requires extra Apple entitlement and a development build. Stay Close V1
does not need contact notes and should not request this entitlement.

### Android Behavior

`expo-contacts` supports Android and is included in Expo Go. The library adds contact read/write
permissions automatically for app builds. Stay Close should only read contacts in V1. If Android
write permission appears in generated manifests due to the library default, permission audit issue
must document whether it can be removed or why it is present.

### Permissions

Use Contacts permission only for reading native contacts. The app must support:

- Granted.
- Denied.
- Undetermined.
- iOS limited access.
- Permission revoked after initial grant.

### Limitations

Native Contacts remains the source of truth. Store stable native contact IDs and minimal display
snapshots only. Do not store the whole address book.

## Local Notifications

### Current Expo API

Use `expo-notifications`.

Relevant APIs:

- `Notifications.scheduleNotificationAsync()`.
- `Notifications.cancelScheduledNotificationAsync()`.
- `Notifications.cancelAllScheduledNotificationsAsync()`.
- `Notifications.getAllScheduledNotificationsAsync()`.
- `Notifications.getPermissionsAsync()`.
- `Notifications.requestPermissionsAsync()`.
- `Notifications.setNotificationHandler()`.
- `Notifications.getLastNotificationResponse()` or related startup response APIs.

### iOS Behavior

iOS supports local notification scheduling through Expo. Notification permission is more granular
than Android; implementation should inspect the iOS authorization status, including not determined,
denied, authorized, provisional, and ephemeral states.

When the app is launched from a notification, response listeners should be registered early and
startup should also check the last notification response.

### Android Behavior

Android supports local notification scheduling through Expo. Android 8+ requires notification
channels for meaningful notification behavior. Android 13 requires the user to opt in to
notifications; the permission prompt appears after a channel exists.

`expo-notifications` automatically adds `RECEIVE_BOOT_COMPLETED`, used to set up scheduled
notifications when the device restarts.

Android 12+ exact-time notifications may require `SCHEDULE_EXACT_ALARM`. V1 should avoid depending
on exact alarms unless product validation proves they are required. If exact alarms are required,
that permission must be documented in the permission audit and app config.

### Expo Go vs Development Build

Local notifications remain available in Expo Go. Push notifications are not part of V1 and should
not be implemented.

Use development builds for V1 validation because notification icons, channels, native config,
permissions, app identity, and production-like behavior cannot be fully validated in Expo Go.

### Limitations

Notification delivery is not equivalent to reminder completion. The persistent reminder task in
SQLite is the source of truth. Missed notifications do not destroy tasks.

OS delivery behavior can vary by device state, user settings, Do Not Disturb, vendor battery
policies, and force-stop behavior. The app must reconcile reminders and scheduled notification
identifiers on startup.

## Reboot and Recovery

Android includes boot-completed support through `expo-notifications`, but the app must still
reconcile persisted reminders against scheduled notifications on app startup.

iOS does not give Stay Close a reliable general-purpose background scheduler for arbitrary app logic
after reboot. The app should treat SQLite reminder state as authoritative and repair notification
state when the app opens.

V1 acceptance must include real-device reboot tests for Android and iOS. If a platform drops
scheduled local notifications across reboot or force-stop in a tested case, document the behavior
and rely on startup reconciliation for persistent in-app tasks.

## Phone Links

### Current API

Use React Native or Expo `Linking`.

Relevant URL:

- `tel:+123456789`

### iOS Behavior

`tel:` links cannot be fully validated on the iOS Simulator because there is no dialer. Test on a
physical iPhone.

### Android Behavior

Android can open phone links through installed dialer apps. Android 11+ package visibility rules may
require manifest `queries` entries when using `canOpenURL`.

### Limitations

Launching `tel:` does not mean a call happened. Completion remains manual.

## WhatsApp Links

### Current API

Use `Linking.openURL()` with a WhatsApp-supported URL format. Prefer a universal `https://wa.me/`
link for a phone number, because it can fall back to a browser if WhatsApp is unavailable.

If using the custom `whatsapp://` scheme, add iOS `LSApplicationQueriesSchemes` and Android package
visibility `queries` before relying on `canOpenURL`.

### iOS Behavior

`canOpenURL` can return false if the scheme is not listed in `LSApplicationQueriesSchemes`. Apple
also limits scheme queries. Prefer opening universal links and handling failure where possible.

### Android Behavior

Android 11+ can reject `canOpenURL` checks unless intent queries are declared in the manifest.

### Limitations

Opening WhatsApp does not mean a message was sent. Completion remains manual. Missing WhatsApp or
invalid phone numbers must produce explicit recoverable errors.

## Expo Go and Development Build Decision

Use Expo Go only for early iteration when the needed native APIs are already included.

Use development builds for:

- V1 device validation.
- App-specific native config.
- Contacts permission messages.
- Android notification channels and icons.
- iOS URL scheme query configuration.
- Android URL intent query configuration.
- Production-like notification and linking behavior.

This is still an Expo-managed project. Development builds do not mean rewriting native code.

## V1 Risks and Follow-up Actions

- Android exact alarm behavior may affect precise reminder timing. Start with normal scheduled local
  notifications and validate whether exact alarms are necessary.
- iOS limited contacts access on iOS 18+ must be modeled explicitly.
- Physical device testing is required for Phone links, notification delivery, and reboot behavior.
- Permission audit must examine generated Android contacts permissions, especially write contact
  access if the library adds it automatically.
- Startup reconciliation is required because notification state is not the source of truth.

## Implementation Guidance

- Implement platform APIs behind ports from `docs/ARCHITECTURE.md`.
- Never let UI components call Expo Contacts or Expo Notifications directly.
- Persist reminder task state before scheduling local notifications.
- Store notification identifiers after successful scheduling.
- Reconcile scheduled notifications on startup and after schedule/reminder changes.
- Treat every external communication launch as "opened attempt", not "contact completed".
