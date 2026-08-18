<div align="center">

# 🤝 Stay Close

**A private, local-first relationship reminder app.**  
No cloud. No account. No tracking. Your contacts never leave your device.

[![CI](https://github.com/abubakarshahid16/stay-close/actions/workflows/ci.yml/badge.svg)](https://github.com/abubakarshahid16/stay-close/actions/workflows/ci.yml)
[![Release](https://github.com/abubakarshahid16/stay-close/actions/workflows/build-android.yml/badge.svg)](https://github.com/abubakarshahid16/stay-close/releases/latest)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Privacy](https://img.shields.io/badge/privacy-100%25%20local-purple)](#-privacy)

---

## ⬇️ Install Now

<table>
<tr>
<td align="center" width="33%">

### 🤖 Android

<a href="https://github.com/abubakarshahid16/stay-close/releases/latest">
  <img src="https://img.shields.io/badge/Download%20APK-Android-brightgreen?style=for-the-badge&logo=android&logoColor=white" alt="Download APK" />
</a>

Download & open the `.apk` file  
Allow "Install unknown apps" once  
No Play Store needed

</td>
<td align="center" width="33%">

### 🌐 Web (any device)

<a href="https://abubakarshahid16.github.io/stay-close">
  <img src="https://img.shields.io/badge/Open%20Web%20App-Launch-blue?style=for-the-badge&logo=googlechrome&logoColor=white" alt="Open Web App" />
</a>

Works on any browser  
iPhone · iPad · PC · Mac  
No install required

</td>
<td align="center" width="33%">

### 🍎 iPhone / iPad

<a href="https://abubakarshahid16.github.io/stay-close">
  <img src="https://img.shields.io/badge/Add%20to%20Home%20Screen-iOS-black?style=for-the-badge&logo=apple&logoColor=white" alt="Add to Home Screen" />
</a>

Open web app in **Safari**  
Tap **Share → Add to Home Screen**  
Opens like a native app

</td>
</tr>
</table>

---

</div>

## The Problem

You have people in your life who matter — family, old friends, mentors, colleagues — and life gets busy. Weeks pass. Months pass. You mean to reach out, but you forget. By the time you think of someone, it feels awkward.

**Stay Close fixes that.** It gently reminds you who to reach out to next, one person at a time.

## ✨ Features

- **Smart reminders** — A weighted algorithm picks who you've neglected the longest, with a little randomness so it doesn't feel mechanical
- **Circles** — Group your contacts (Family, Friends, Work, etc.) each with their own reminder cadence: daily, every 3 days, weekly, every 2 weeks, or monthly
- **Three actions** — "Done — I reached out ✓", "Show someone else", or "Skip for now"
- **Contact picker** — Search and add directly from your phone contacts
- **Privacy-first notifications** — Optional local push notifications that show "Time to reach out" without naming the person
- **Backup & restore** — Export your data as a JSON file; import it anytime
- **Zero internet** — No network calls, ever. Nothing leaves your phone.

## 📱 Install Guide

### Android

1. Go to the [**latest release**](https://github.com/abubakarshahid16/stay-close/releases/latest)
2. Download `stay-close-vX.X.X.apk`
3. Open the file on your phone — tap **Install**
4. If prompted, allow **Install unknown apps** for your browser in Settings (one-time only)

> Android only needs this permission once. Stay Close itself has **no internet permission**.

### iPhone & iPad (Safari PWA)

1. Open **[abubakarshahid16.github.io/stay-close](https://abubakarshahid16.github.io/stay-close)** in Safari
2. Tap the **Share** button (box with arrow at the bottom)
3. Tap **Add to Home Screen**
4. Tap **Add** — the app icon appears on your home screen

### Web (PC / Mac / any browser)

Open **[abubakarshahid16.github.io/stay-close](https://abubakarshahid16.github.io/stay-close)** — no install needed.

## 🔒 Privacy

- **No internet permission** on Android — the app literally cannot make network calls
- **No account required** — nothing to sign up for
- **No analytics, no ads, no tracking** of any kind
- **Your contacts never leave your device**
- All data stored locally in SQLite on your phone

## 🛠 Tech Stack

| | |
|---|---|
| Framework | React Native + Expo SDK 57 |
| Navigation | Expo Router (file-based) |
| Database | expo-sqlite (local SQLite) |
| Language | TypeScript (strict) |
| CI/CD | GitHub Actions |
| Android builds | Gradle (no EAS required) |
| Web hosting | GitHub Pages |

## 👩‍💻 For Developers

### Run locally

```bash
git clone https://github.com/abubakarshahid16/stay-close.git
cd stay-close
npm install
npx expo start
```

### Release an Android APK

```bash
git tag v1.0.1
git push origin v1.0.1
# APK appears at /releases in ~15 minutes
```

GitHub Actions builds the APK automatically on every `v*.*.*` tag.

### Run tests

```bash
npm test
```

## 📁 Project Structure

```
stay-close/
├── app/                        # Expo Router screens
│   ├── _layout.tsx             # Root layout (DatabaseProvider)
│   ├── (tabs)/                 # Tab navigation
│   │   ├── index.tsx           # Home — today's suggestion
│   │   └── circles.tsx         # Circles list
│   ├── circles/
│   │   ├── create.tsx          # Create circle modal
│   │   ├── [id].tsx            # Circle detail + people
│   │   └── [id]/select.tsx     # Contact picker
│   ├── settings/index.tsx      # Settings screen
│   └── onboarding/index.tsx    # First-run onboarding
├── src/
│   ├── db/
│   │   ├── database.ts         # Migration runner
│   │   └── repositories/       # CircleRepo, PeopleRepo, HistoryRepo, SettingsRepo
│   ├── services/
│   │   ├── ReminderEngine.ts   # Weighted selection algorithm
│   │   ├── ContactService.ts   # expo-contacts wrapper
│   │   ├── NotificationService.ts
│   │   └── BackupService.ts    # Export / import JSON
│   ├── context/DatabaseContext.tsx
│   ├── hooks/                  # useCircles, useSettings
│   ├── components/             # LoadingView, ErrorView, etc.
│   ├── types/                  # TypeScript interfaces
│   └── utils/validation.ts
├── __tests__/                  # All test suites
└── .github/workflows/
    ├── ci.yml                  # Tests on every push
    ├── build-android.yml       # APK + GitHub Release on tag
    └── deploy-web.yml          # GitHub Pages on main push
```

## 🤝 Contributing

Contributions are welcome!

- 🐛 [Report a bug](https://github.com/abubakarshahid16/stay-close/issues/new?template=bug_report.yml)
- 💡 [Request a feature](https://github.com/abubakarshahid16/stay-close/issues/new?template=feature_request.yml)

## 📄 License

MIT © [abubakarshahid16](https://github.com/abubakarshahid16) — see [LICENSE](LICENSE) for details.

---

<div align="center">
Made with ❤️ for people who care about staying connected.
</div>
