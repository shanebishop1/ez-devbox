---
name: ez-devbox
description: Install, configure, and use ez-devbox, a CLI that runs coding agents in disposable E2B cloud sandboxes with persistent sessions.
---

# ez-devbox E2B sessions

`ez-devbox` creates E2B cloud sandboxes, clones and bootstraps repositories, and launches OpenCode, Codex, Claude Code, or a shell in sessions you can reconnect to later.

Use explicit sandbox IDs for automation. `resume` uses shared last-run state and can race across concurrent callers.

Start with `create --detach --json`; `lifecycle.agent: ready` indicates agent readiness. `--detach` skips attachment; `--json` formats output.

- For installation, credentials, and configuration, read [references/setup.md](references/setup.md).
- For creating, attaching, prompting, inspecting, or cleanup, read [references/sessions.md](references/sessions.md).
- For remote argv, shell scripts, output, and timeouts, read [references/commands.md](references/commands.md).

Reuse the returned sandbox and tmux identities.
