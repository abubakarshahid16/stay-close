# Changelog

All notable changes to Stay Close are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [Unreleased]

### Added
- **Create Circle screen** (`app/circles/create.tsx`) — name + frequency picker with validation; navigates straight into adding people
- **Circle detail screen** (`app/circles/[id]/index.tsx`) — rename, change frequency, list/remove people, delete circle
- **Add People screen** (`app/circles/[id]/select.tsx`) — device-contact picker with search and multi-select, plus manual entry fallback (used on web and when contact permission is declined)
- **Onboarding gate** — first launch now redirects to the onboarding flow (previously unreachable)
- **Notification wiring** — reminders are scheduled on circle create, rescheduled on frequency change, cancelled on circle delete and on Delete All Data; foreground handler registered at app start
- **Restore Backup** in Settings (expo-document-picker on native, file picker on web)
- **Web support made real**: added missing `react-native-web`, `react-dom`, `react-native-safe-area-context`, `react-native-screens`, `expo-linking`, `expo-constants` dependencies; `metro.config.js` with WASM asset support for expo-sqlite on web; browser-download backup export; web-safe alert/confirm dialogs (`src/utils/dialogs.ts`)
- Component test suites for the new screens; suite now at 136 tests / 13 suites

### Fixed
- Home and Circles screens now refresh on focus (previously showed stale data after creating a circle or adding people)
- `Alert.alert` no-op on web replaced with cross-platform dialogs (Delete All Data was silently broken in browsers)
- GitHub Pages deploy: web export now builds with `baseUrl: /stay-close` (site previously 404'd), SPA fallback `404.html` added, Pages auto-enablement turned on
- CI now runs ESLint and the db/integration suites; all lint errors fixed

### Phase 0 — Product Definition
- Complete product documentation: PRODUCT.md, ARCHITECTURE.md, PRIVACY.md, SECURITY.md, THREAT_MODEL.md, DATABASE.md, CONTACTS.md, REMINDER_ENGINE.md, NOTIFICATIONS.md, TESTING.md, QA_CHECKLIST.md, ACCESSIBILITY.md, RELEASE.md
- Architecture Decision Records (ADR 001–010)
- GitHub PR template and issue templates
- CI workflow configuration
- Branch protection documentation
- Defined SQLite schema design
- Defined weighted reminder selection algorithm
- Defined testing strategy and six-level testing pyramid

---

*Phases 1–14 will be logged here as development progresses.*
