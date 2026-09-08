---
name: ez-devbox
description: Install and configure ez-devbox; create, list, reconnect, prompt agents, run remote commands, and delete E2B cloud devboxes.
---

# ez-devbox

`ez-devbox` creates E2B cloud sandboxes, clones and bootstraps repositories, and launches OpenCode, Codex, Claude Code, or a shell in sessions you can reconnect to later.

1. Install the CLI and prepare credentials/config using [setup](references/setup.md).
2. Create or list devboxes, attach over SSH/web, send agent prompts, and clean up using [sessions](references/sessions.md).
3. Execute remote commands and inspect agent output using [commands](references/commands.md).

These references are bundled with this skill; no source checkout or repository documentation is required. Run CLI commands from the configured project directory, not the skill directory.

For automation, use `create --detach --json` and save `sandboxId`, `mode`, `workingDirectory`, and `connection`. `lifecycle.agent: ready` means the agent session is ready, not that its task is complete. `--detach` skips attachment; `--json` only formats output.

Use explicit sandbox IDs and returned tmux identities. `resume` uses shared last-run state and can race across callers. Preserve remote work before deletion; exiting or detaching does not delete a devbox.
