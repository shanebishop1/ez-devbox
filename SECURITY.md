# Security Policy

## Supported versions

Security fixes are made for the latest npm release. Upgrade to the current version before reporting behavior that may already be fixed.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability or include credentials in logs, screenshots, or reproductions. Report privately through [GitHub Security Advisories](https://github.com/shanebishop1/ez-devbox/security/advisories/new).

Include the affected version, host OS, startup mode, impact, and minimal reproduction steps. Redact E2B, GitHub, model-provider, and tool-auth credentials. You should receive an acknowledgement within seven days; remediation timing depends on severity and reproducibility.

## Security model

- ez-devbox copies only configured tool state and selected environment variables into an E2B sandbox. That sandbox and its repositories must be trusted with those credentials.
- `.env`, OpenCode/Codex/Claude auth state, GitHub CLI state, and tunnel URLs are secrets. Never commit or publish them.
- Cloudflare quick tunnels provide public HTTPS URLs, not private, sandbox-only access. HTTPS protects transport but does not authorize callers. ez-devbox does not configure Cloudflare Access or add tunnel authentication: anyone with the URL can reach the forwarded service while the tunnel is running, subject to that service's own authentication.
- Treat tunnel URLs as bearer secrets. Keep them out of public logs, screenshots, and shared agent transcripts. Require upstream authentication for sensitive services; do not tunnel unauthenticated administrative endpoints. If a URL is disclosed, stop the tunnel and review upstream access logs and credentials as appropriate.
- Sandboxes persist independently of the local terminal until their E2B timeout or explicit deletion. Use `ez-devbox wipe` when work is complete and revoke credentials if a sandbox may be compromised.

Dependency-only reports without a demonstrated impact on this package may be handled through routine upgrades rather than a security advisory.
