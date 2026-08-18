# Contacts

## Design Principle

The user's device contacts are the primary data source for selecting people to add to circles. Stay Close does not ask users to manually type names and numbers. It reads the OS contact list with explicit permission and allows the user to choose specific people.

**All contact processing happens on the device. No contact information is ever transmitted.**

---

## Permission Strategy

### Step 1 — Privacy Explanation Screen

Before any OS permission dialog is triggered, the user sees a plain-language explanation:

```
Your Contacts Stay Private

Stay Close uses your contacts only so you can choose
the people you want to stay connected with.

Your contacts are processed on this device.

They are never uploaded to our servers.

We do not have access to them.

[ Continue ]
```

This screen appears before the OS dialog every time permission needs to be requested — on first install and after revocation.

### Step 2 — OS Permission Request

Only after the user taps Continue does the OS permission dialog appear.

- **iOS**: System dialog requesting access to Contacts
- **Android**: Runtime permission request for `READ_CONTACTS`

### Step 3 — Permission Granted

Contact loading begins. The user is taken to contact selection.

### Step 4 — Permission Denied

The OS dialog is dismissed with Deny. Stay Close shows:

```
Contact access is needed so you can choose the
people you want reminders for.

You can enable it anytime from Settings.

[ Open Settings ]   [ Not Now ]
```

- **Open Settings**: Takes the user to OS app settings where they can manually grant permission
- **Not Now**: Dismisses — the user can still use the app but cannot create circles with people

### Step 5 — Permission Denied Permanently (Android)

On Android, after the user denies twice, the OS may no longer show the dialog. Stay Close detects this via `expo-contacts` and shows the explanation with Open Settings instead of triggering another dialog.

### Harassment Prevention

Stay Close does not:

- Show the permission explanation more than once per session if already denied
- Show the OS permission dialog more than the OS allows
- Interrupt the user's normal use repeatedly asking for permission

The permission explanation is shown once per need. If denied, the user must proactively open Settings.

---

## Contact Loading

After permission is granted:

1. `expo-contacts` reads the device contact list
2. Contacts are presented in a searchable list
3. The user selects specific individuals
4. Only those individuals are stored in the local database

**The entire address book is never stored in SQLite.** Only selected people appear in `circle_people`.

### Contact Fields Read

| Field | Purpose |
|---|---|
| `id` (native) | Stable identifier for contact tracking |
| `name` | Display name shown in the app |
| `phoneNumbers` | Array — user selects one number per person |

Fields explicitly NOT read:

- Email addresses
- Postal addresses
- Birthdays
- Notes
- Organisation / company
- Contact photo (not stored; may be shown during selection from OS)
- Relationships
- Social profiles

---

## Contact Selection Screen

The selection screen is presented when the user adds people to a circle.

```
Choose People for Family

Search contacts...

─────────────────────
□  Alex Example
□  Jamie Example
□  Taylor Example
□  Jordan Example
□  Sam Example
─────────────────────

[ Add 3 Selected People ]
```

Features:

- **Search**: Real-time filtering of contact names
- **Select**: Tap to select an individual
- **Deselect**: Tap again to remove selection
- **Multi-select**: Select any number of people
- **Clear**: Button to clear all selections
- **Already Added**: Contacts already in the circle are shown as already selected (cannot double-add)

Contact photos may be shown as thumbnails from the OS to help identification but are not stored in the app database.

---

## Contact with Multiple Phone Numbers

When a user selects a contact that has multiple phone numbers, a secondary prompt allows them to choose which number to associate:

```
Alex Example has multiple numbers

● Mobile  +1 555 000 0001
○ Work    +1 555 000 0002
○ Home    +1 555 000 0003

[ Select ]
```

The selected number is stored in `circle_people.phone_number`. Only one number per person per circle is stored.

---

## Contact Synchronisation

Users change contacts over time. Stay Close handles this gracefully.

### Scenario: Contact Renamed

When a circle is opened or a reminder is triggered, Stay Close reads the stored `contact_identifier` and refreshes the `display_name` and `phone_number` from the OS contact list.

If the name has changed, the stored display name is updated silently.

### Scenario: Contact Deleted

When Stay Close attempts to load a contact by `contact_identifier` and the OS reports no contact with that ID:

```
This contact is no longer available on your phone.

[ Remove From Circle ]
```

The user is informed and given a single action. Stay Close does not silently replace the person with someone else.

### Scenario: Phone Number Changed

The refreshed phone number from the OS is used. If the stored number is no longer valid, the updated number replaces it when the contact is loaded.

### Sync Timing

Contact information is refreshed:

- When a circle is opened
- When a reminder suggestion is generated
- When the user views reminder details

Contact sync is always local — it reads from the OS contacts API only.

---

## Contact Identifier Reliability

Native contact identifiers differ between platforms:

| Platform | Identifier Type | Notes |
|---|---|---|
| iOS | String UUID | Generally stable; can change if user merges contacts |
| Android | Long integer string | Can change if contacts are synced from a new account |

Stay Close uses the native identifier as the primary key for identifying a stored contact on the OS. If an identifier changes and the contact cannot be found, the contact-not-available state is shown.

Future consideration: match by name + number as a fallback if the identifier is no longer found, to handle cases where the identifier changed but the person is still in the address book.

---

## Privacy Rules for Contact Handling

1. No contact information is logged beyond the system-level event (e.g., "contact loaded" not "Ahmed Khan loaded")
2. No contact information is written to any temporary file
3. Contact photos are shown via OS APIs only — they are not copied or stored by the app
4. Contact data does not appear in GitHub screenshots (fake data is used)
5. Contact loading does not trigger a network request

---

## Testing Contact Scenarios

The following scenarios must be covered by automated tests (mocking `expo-contacts`) and manual QA:

| Scenario | Test Level |
|---|---|
| Permission granted — contacts load | Unit + Integration |
| Permission denied — correct UI shown | Unit + Integration |
| Permission revoked after use | Integration + Manual |
| No contacts on device | Unit |
| One contact | Unit |
| Hundreds of contacts | Integration |
| Contact with no name | Unit |
| Contact with no phone number | Unit |
| Contact with multiple phone numbers | Unit + Integration |
| Unicode contact name | Unit |
| Emoji in contact name | Unit |
| Extremely long contact name | Unit |
| Duplicate display names | Unit |
| Deleted contact (ID no longer found) | Unit + Integration |
| Renamed contact | Unit + Integration |
| Updated phone number | Unit + Integration |
| Search — no results | Unit |
| Search — multiple results | Unit |
| Selection and deselection | Component |
| Multi-selection | Component |
| Already-added contact shown as selected | Component |
| App restarted after contact selection | Integration |

See TESTING.md for test implementation strategy.

---

## Platform-Specific Notes

### iOS

- `expo-contacts` maps to `CNContactStore`
- Contact identifiers are CNContact.identifier (UUID string)
- Permission status: `notDetermined`, `authorized`, `denied`, `restricted`
- `restricted` means parental controls block contact access — cannot request, show appropriate message

### Android

- `expo-contacts` maps to Android `ContactsContract`
- Contact identifiers are Android Contact `_ID` values
- Permission status: `granted`, `denied`, `never_ask_again`
- On Android 13+, no additional contacts sub-permission is needed for basic reading
