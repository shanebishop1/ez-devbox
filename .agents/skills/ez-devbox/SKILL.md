---
name: ez-devbox
description: Manage persistent coding-agent sessions in E2B sandboxes with the ez-devbox CLI.
---

# ez-devbox E2B sessions

Use explicit sandbox IDs for automation. `resume` uses shared last-run state and can race across concurrent callers.

Start with `create --detach --json`; `lifecycle.agent: ready` indicates agent readiness. `--detach` skips attachment; `--json` formats output.

- For creating, attaching, prompting, inspecting, or cleanup, read [references/sessions.md](references/sessions.md).
- For remote argv, shell scripts, output, and timeouts, read [references/commands.md](references/commands.md).

Reuse the returned sandbox and tmux identities.
