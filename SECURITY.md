# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| Latest  | ✅        |
| Older   | ❌        |

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Email: [open a private security advisory](https://github.com/abubakarshahid16/stay-close/security/advisories/new) on GitHub.

We will respond within 7 days.

## Security model

Stay Close has a very small attack surface by design:

- **No network permission** — the app cannot make outbound connections
- **No backend** — there is no server to compromise  
- **Local SQLite only** — data is in the app's sandbox directory, inaccessible to other apps
- **No third-party SDKs** that phone home — every dependency is audited for network calls
- **Backup files are plain JSON** — inspect them yourself at any time
