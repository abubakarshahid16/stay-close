# ADR 007 — Local Notifications (No Push Backend)

**Status**: Accepted  
**Date**: Phase 0

---

## Context

Mobile notifications can be delivered in two ways:
1. **Push notifications** — sent from a server to the device via APNs (iOS) or FCM (Android)
2. **Local notifications** — scheduled on the device itself, delivered without any server involvement

---

## Decision

Stay Close uses **local notifications only** via `expo-notifications`.

There is no:
- Push notification server
- APNs token registration
- FCM token registration
- Backend service that sends notifications
- Any server-side scheduling

All notification scheduling happens entirely on the device.

---

## Alternatives Considered

**Push notifications via Firebase Cloud Messaging / APNs**: Rejected.
- Requires a backend server to store notification schedules and send them
- Requires device tokens to be registered with a server — privacy concern
- Introduces internet dependency for what should be a local feature
- Firebase SDK would need to be carefully isolated to prevent analytics
- Significant infrastructure to build and maintain
- Completely unnecessary for a local reminder app

**Background fetch + push**: Rejected. Same concerns as above.

**expo-notifications local only**: Selected.
- Notifications are scheduled and delivered entirely on-device
- No server, no token registration
- Works in Airplane Mode
- Aligned with the local-first, no-network architecture
- expo-notifications is maintained by Expo
- Handles both iOS and Android with a consistent API

---

## Consequences

- Notification scheduling works in Airplane Mode
- No push notification infrastructure to maintain or pay for
- No device tokens stored anywhere
- Android: Notifications may need rescheduling after device restart (RECEIVE_BOOT_COMPLETED permission required)
- iOS: Notifications persist through device restart automatically
- The maximum number of scheduled local notifications is limited by the OS (~64 on iOS, more on Android) — with a small number of circles, this is not a concern
- Notification delivery is approximately on-time but not guaranteed to be exact (OS scheduling may delay slightly)
