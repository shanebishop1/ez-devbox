---
name: ez-devbox
description: Create, reconnect, inspect, and clean up persistent coding-agent sessions in E2B sandboxes with the ez-devbox CLI. Use for ez-devbox or E2B session-management requests; do not use it as a task queue or orchestration layer.
---

# ez-devbox E2B sessions

Use explicit sandbox IDs for automation. `resume` is human-friendly shared last-run state and can race across concurrent callers.

Start automation with `create --detach --json`; treat `lifecycle.agent: ready` as readiness. Keep `--json` independent from `--detach`.

- For creating, attaching, prompting, inspecting, or cleanup, read [references/sessions.md](references/sessions.md).
- For remote argv, shell scripts, output, and timeouts, read [references/commands.md](references/commands.md).

Never print connection credentials or copy secrets into command text. Reuse the returned sandbox and tmux identities.
