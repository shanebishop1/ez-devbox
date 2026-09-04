# Security Policy

## Supported versions

Security fixes are made for the latest npm release. Upgrade to the current version before reporting behavior that may already be fixed.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability or include credentials in logs, screenshots, or reproductions. Report privately through [GitHub Security Advisories](https://github.com/shanebishop1/ez-devbox/security/advisories/new).

Include the affected version, host OS, startup mode, impact, and minimal reproduction steps. Redact E2B, GitHub, model-provider, and tool-auth credentials. You should receive an acknowledgement within seven days; remediation timing depends on severity and reproducibility.

## Security model

- ez-devbox copies only configured tool state and selected environment variables into an E2B sandbox. That sandbox and its repositories must be trusted with those credentials.
- `.env`, OpenCode/Codex/Claude auth state, GitHub CLI state, and tunnel URLs are secrets. Never commit or publish them.
- Quick-tunnel URLs act as bearer links. Protect the upstream service and share URLs only with intended users.
- Sandboxes persist independently of the local terminal until their E2B timeout or explicit deletion. Use `ez-devbox wipe` when work is complete and revoke credentials if a sandbox may be compromised.

Dependency-only reports without a demonstrated impact on this package may be handled through routine upgrades rather than a security advisory.
