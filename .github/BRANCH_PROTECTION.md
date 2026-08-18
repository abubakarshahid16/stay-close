# Branch Protection Configuration

This document describes the recommended GitHub branch protection settings for the `main` branch. Configure these in: **Settings → Branches → Branch protection rules**.

## Recommended Settings for `main`

```
Branch name pattern: main

☑ Require a pull request before merging
  Required number of approvals: 1
  ☑ Dismiss stale pull request approvals when new commits are pushed

☑ Require status checks to pass before merging
  Required status checks:
    - Lint and Type Check
    - Unit Tests
    - Database Integration Tests
    - Component Tests
    - Integration Tests
    - Security Audit

☑ Require branches to be up to date before merging

☑ Require conversation resolution before merging

☑ Do not allow bypassing the above settings

☐ Allow force pushes  (DISABLED)
☐ Allow deletions     (DISABLED)
```

## Merge Strategy

Prefer **Squash and merge** for focused feature branches to keep main history clean.

Use **Merge commit** only for release branches where full history is meaningful.

## Auto-delete Branches

Enable **Automatically delete head branches** after merge to keep the repository tidy.

## Why

- `main` must always be stable and deployable
- CI must pass before any merge — no exceptions
- No force-pushing main prevents history rewriting
- Conversation resolution ensures review feedback is acknowledged
