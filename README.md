# Stay Close

Stay Close is a private, offline-first relationship-maintenance app for iOS and Android.

This repository is being rebuilt issue by issue from the functional roadmap. The current milestone
is `M1 - Foundation`.

## Requirements

- Node.js 24 or newer
- npm
- Expo-compatible iOS or Android development environment

## Setup

```powershell
npm ci
```

## Development

Start the Expo development server:

```powershell
npm run start
```

Run on Android:

```powershell
npm run android
```

Run on iOS:

```powershell
npm run ios
```

On Windows, iOS simulator launch is not available because Apple's iOS simulator requires macOS and
Xcode. Use a Mac for simulator validation or a documented physical-device Expo workflow.

Typecheck:

```powershell
npm run typecheck
```

Project health check:

```powershell
npx expo-doctor
```

Security audit gate used during foundation setup:

```powershell
npm audit --audit-level=high
```

Moderate transitive audit findings from Expo CLI dependencies should be reviewed in the security
milestone. Do not use `npm audit fix --force` if it downgrades Expo or React Native.

## V1 Boundaries

- No backend.
- No login or user account.
- No analytics, telemetry, advertising, or tracking SDKs.
- No database, contacts, reminders, notifications, or feature screens in issue `004`.
