# Release

## Release Philosophy

Stay Close is released when it is ready — not when a deadline demands it. A release that ships broken core functionality or privacy violations is worse than no release.

**No release if critical automated tests fail.**

---

## Release Checklist

### Pre-Release Requirements

- [ ] All Phase 1–11 work is complete (Engineering Foundation through Complete Functional QA)
- [ ] All automated tests pass on CI
- [ ] Coverage requirements met for critical modules
- [ ] Full manual QA completed (QA_CHECKLIST.md — all items ✅ or N/A)
- [ ] Privacy verification checklist completed (PRIVACY.md)
- [ ] Security checklist completed (SECURITY.md)
- [ ] Accessibility manual QA completed (ACCESSIBILITY.md)
- [ ] All critical and high GitHub issues resolved
- [ ] No open issues labelled `blocks-release`

### Code Quality

- [ ] `npm run lint` — passes with zero errors
- [ ] `npm run typecheck` — passes with zero errors
- [ ] `npm test` — all tests pass
- [ ] `npm run test:db` — all database tests pass
- [ ] `npm run test:integration` — all integration tests pass
- [ ] `npm audit` — no high or critical vulnerabilities

### Privacy and Security

- [ ] Android manifest reviewed — no INTERNET permission declared
- [ ] iOS Info.plist reviewed — only expected usage keys
- [ ] Dependency tree reviewed — no unexpected network-calling packages
- [ ] Network proxy test — zero outbound requests during normal use
- [ ] Production log test — no PII in logs during normal use
- [ ] Notification content in Private mode — no contact names
- [ ] Backup file reviewed — contains only documented data
- [ ] Delete data function verified — removes all documented categories

### Repository

- [ ] Git history reviewed — no personal data in any commit
- [ ] No real contact names in screenshots or documentation
- [ ] All secrets (if any) are in GitHub Secrets — not in code
- [ ] `.gitignore` covers all sensitive file patterns
- [ ] README.md is up to date

### Build

- [ ] Android AAB (or APK) builds successfully
- [ ] iOS IPA builds successfully
- [ ] Both builds tested on real hardware

### Documentation

- [ ] README.md updated with current phase status
- [ ] CHANGELOG.md created / updated
- [ ] Any new feature has corresponding documentation
- [ ] Screenshots in docs/screenshots/ are up to date with fake data

---

## Versioning

Follow Semantic Versioning: `MAJOR.MINOR.PATCH`

| Type | When |
|---|---|
| MAJOR | Breaking change to backup format or significant product pivot |
| MINOR | New feature added in a backward-compatible manner |
| PATCH | Bug fix |

v1.0.0 is the first complete release containing all Phase 1–11 features.

---

## Changelog

Maintain `CHANGELOG.md` following Keep a Changelog format:

```markdown
# Changelog

## [Unreleased]

## [1.0.0] — YYYY-MM-DD
### Added
- Circle creation and management
- Contact selection from device contacts
- Weighted reminder engine
- Local notifications (private and detailed modes)
- Backup and restore
- Delete all data

### Fixed
- (none at initial release)
```

---

## Release Branch Strategy

```
main (stable)
  └── release/1.0.0  ← created from main when preparing release
        └── fix/release-blocker-xxx ← hotfixes merged into release branch
              ↓
       Tagged as v1.0.0
              ↓
       Merged back into main
```

---

## GitHub Release

Create a GitHub Release for each version:

1. Tag: `v1.0.0`
2. Release title: `v1.0.0 — Initial Release`
3. Release body:
   - Summary of what the release contains
   - Link to CHANGELOG.md section
   - Any installation notes
   - Privacy statement link

---

## Post-Release

After each release:

- [ ] Monitor for crash reports (if any crash reporting is implemented in a privacy-safe manner)
- [ ] Monitor user feedback channels
- [ ] File new GitHub issues for any reported bugs
- [ ] Plan the next version

---

## Hotfix Process

For critical bugs discovered after release:

```
Create branch: fix/hotfix-description from release tag
    ↓
Fix bug
    ↓
Add regression test
    ↓
CI passes
    ↓
Create PR → review → merge into release branch
    ↓
Tag new patch version (e.g. v1.0.1)
    ↓
Merge into main
```

Hotfixes are only for critical issues (crash, data loss, privacy violation). Non-critical bugs are fixed in the normal development cycle.

---

## App Store Submission

### Android (Google Play)

- Build signed AAB
- Verify permissions in Play Console match AndroidManifest.xml
- Complete data safety section honestly:
  - No data shared with third parties
  - No data collected
  - Data encrypted in transit: N/A (no network)
  - Users can delete data: Yes
- Privacy policy URL (to be created)
- Screenshots using fake demo data

### iOS (App Store)

- Build signed IPA via Xcode or EAS
- Complete App Privacy section in App Store Connect:
  - No data linked to user
  - No data used to track user
  - Contacts permission: used for app functionality, not shared
- Privacy policy URL (to be created)
- Screenshots using fake demo data on iPhone frames

---

## Privacy Policy

A public-facing privacy policy must be created before app store submission. It must:

- Accurately reflect the technical implementation
- Not make claims that cannot be verified against the code
- Be reviewed against the PRIVACY.md checklist
- Be readable by non-technical users

The privacy policy is not part of the code repository but is linked from the app stores and optionally from within the app's Settings screen.
