# Contributing to Stay Close

Thanks for your interest in contributing! Stay Close is a privacy-first app — no cloud, no tracking, no network calls outside this repo.

## Setup

```bash
git clone https://github.com/abubakarshahid16/stay-close
cd stay-close
npm install
npm test
```

## Ground Rules

- Never add network calls to the app
- Never send contact data off-device
- All new features need tests
- Use Conventional Commits: `feat:`, `fix:`, `chore:`

## PR Process

1. Fork and create a branch from `main`
2. Make your changes with tests
3. Run `npm test` and `npx tsc --noEmit`
4. Submit a PR against `main`
