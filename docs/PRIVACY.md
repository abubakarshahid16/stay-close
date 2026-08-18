# Privacy

## Privacy Promise

> Your relationships stay on your phone.

Stay Close uses contact access only so you can choose the people you care about. Your circles, reminders, and relationship information are stored locally on your device. We do not maintain a cloud database of your contacts. We do not sell your data. We do not track your relationships. No account is required. Core functionality works offline.

**This promise must be technically verifiable against the actual implementation before any public claim is made.**

---

## What Data We Access

### Device Contacts (OS Permission Required)

Stay Close requests OS permission to read device contacts.

**Why**: So the user can select people they already know from their phone's contact list, rather than manually typing names and numbers.

**What we read**: Contact display name, phone numbers, and native contact identifier, for the specific contacts the user selects.

**What we do NOT read**: Email addresses, postal addresses, birthdays, notes, organisation fields, relationship fields, photos, or any other contact field.

**What we store**: Only for contacts the user explicitly adds to a circle: the native contact identifier, display name, and one selected phone number. We do not copy the entire address book.

---

## What Data We Store

All data is stored exclusively in a local SQLite database on the user's device.

| Data Type | Stored | Location | Network |
|---|---|---|---|
| Circle names | Yes | Local SQLite | Never |
| Selected contact name | Yes (user-selected only) | Local SQLite | Never |
| Selected contact phone | Yes (user-selected only) | Local SQLite | Never |
| Contact identifier | Yes (user-selected only) | Local SQLite | Never |
| Reminder frequency settings | Yes | Local SQLite | Never |
| Reminder history | Yes | Local SQLite | Never |
| App settings | Yes | Local SQLite | Never |
| Full address book | Never | — | Never |
| Email addresses | Never | — | Never |
| Location data | Never | — | Never |
| Call logs | Never | — | Never |
| Message content | Never | — | Never |

---

## What Data We Never Transmit

Stay Close never transmits any of the following to any external system:

- Contact names
- Phone numbers
- Email addresses
- Contact identifiers
- Circle membership
- Reminder history
- Reminder settings
- App usage patterns
- Device identifiers
- Crash reports containing personal information
- Any analytics event

There is no remote server that Stay Close communicates with during normal operation.

---

## Third-Party SDKs

Stay Close does not include:

- Google Analytics or Firebase Analytics
- Meta / Facebook SDK
- Mixpanel, Amplitude, or similar analytics
- Crashlytics or Sentry (or equivalent crash reporters with network transmission)
- Advertising SDKs of any kind
- A/B testing frameworks
- Any SDK that transmits data to a third party

If a dependency is discovered to transmit data, it is removed immediately and documented in the threat model.

---

## Notification Privacy

Contact names on a lock screen are sensitive.

**Default behaviour (Private mode)**:
```
You have someone to reconnect with.
```

**Optional (user-enabled, Show Person's Name mode)**:
```
Maybe reach out to Ahmed today.
```

The default protects the user from exposing relationship information to bystanders who may see their phone screen.

---

## Contact Permission Experience

The OS permission dialog is never triggered as the first action the app takes.

Before any OS permission request, the user sees a plain-language explanation of why the permission is needed and what the app does with it. The user taps a button to proceed before the OS dialog appears.

If permission is denied, the app explains the impact and offers to open Settings. The app does not repeatedly request permission.

---

## Production Logs

Production logs do not contain:

- Contact names
- Phone numbers
- Contact identifiers
- Circle membership information
- Notification content containing names

Log messages describe events at the system level:

| Bad | Good |
|---|---|
| `Selecting Ahmed Khan +92 300 ...` | `Reminder selection completed.` |
| `Scheduling reminder for circle: Family` | `Reminder scheduled for circle ID.` |
| `Contact search: Ahmed` | `Contact search performed.` |

---

## Development Data Policy

GitHub repositories, screenshots, and documentation must never contain real personal information.

All development datasets use fake placeholder contacts:

- Alex Example
- Jamie Example
- Taylor Example
- Jordan Example
- Sam Example

Any accidental commit of real contact data must be treated as a security incident: the commit must be rewritten from history and the exposure documented.

---

## Backup File Privacy

Backup files exported by the user may contain:

- Circle names
- Selected people's names and phone numbers
- Reminder history

The user is informed of this before export:

```
This backup contains your personal circle information
including the names of people you've selected.

Store it somewhere private.

[ Export Backup ]   [ Cancel ]
```

The app cannot control what happens to backup files after they leave the app sandbox. This is explained honestly to the user.

---

## Data Deletion

The user can delete all application data at any time via Settings → Delete All My Data.

This deletes:

- All circles
- All selected people
- All reminder history
- App settings
- All scheduled local notifications managed by the app

This does NOT delete:

- Backup files the user has previously exported (they live outside the app sandbox)
- The device contacts themselves (Stay Close has read access only, never write access)

The user is shown a confirmation dialog before deletion proceeds.

---

## Android Permissions Declared

```xml
<uses-permission android:name="android.permission.READ_CONTACTS" />
<uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
<uses-permission android:name="android.permission.RECEIVE_BOOT_COMPLETED" />
```

Permissions that will **never** be declared:

```xml
<!-- Never -->
<uses-permission android:name="android.permission.WRITE_CONTACTS" />
<uses-permission android:name="android.permission.READ_CALL_LOG" />
<uses-permission android:name="android.permission.READ_SMS" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
<uses-permission android:name="android.permission.ACCESS_COARSE_LOCATION" />
<uses-permission android:name="android.permission.INTERNET" />
```

Note: `INTERNET` permission will not be declared. This enforces the no-network contract at the OS level.

---

## iOS Permission Strings

`Info.plist` will include:

```xml
<key>NSContactsUsageDescription</key>
<string>Stay Close uses your contacts so you can choose the people you want to stay connected with. Your contacts are never uploaded from your device.</string>
```

Strings that will **never** appear:

- `NSLocationWhenInUseUsageDescription`
- `NSLocationAlwaysUsageDescription`
- `NSSpeechRecognitionUsageDescription`
- `NSMicrophoneUsageDescription`
- `NSCameraUsageDescription`

---

## Privacy Verification Checklist

Before any public release, the following must be verified against the actual implementation:

- [ ] No network request is made during any core user flow
- [ ] No contact data appears in production logs
- [ ] No contact data is written outside the local SQLite database
- [ ] No analytics or tracking SDK is present in the dependency tree
- [ ] The Android manifest does not declare INTERNET permission
- [ ] The iOS Info.plist contains only required usage descriptions
- [ ] Backup files contain only the stated data categories
- [ ] Notification content in private mode contains no contact names
- [ ] The delete data function removes all stated categories
- [ ] No personal data exists in git history
- [ ] All GitHub screenshots use fake demo data

---

## Privacy Architecture Review

The privacy architecture is reviewed during Phase 10 (Security & Privacy Hardening) and must be re-reviewed for any PR that:

- Adds a new dependency
- Changes how contacts are accessed or stored
- Changes notification content
- Changes backup file contents
- Adds any new data storage location
- Changes logging behaviour

Review is documented in the PR using the Privacy Impact field of the PR template.
