# Agent and automation usage

`ez-devbox` keeps one E2B sandbox and one persistent agent/tmux identity. It does not add task IDs, queues, or a scheduler.

## Detached startup

```bash
ez-devbox create --mode ssh-opencode --detach --json
```

`--detach` controls attachment; `--json` controls formatting. JSON `lifecycle` separately reports sandbox creation, agent readiness, and attachment. SSH modes return tmux connection details; web mode returns its endpoint. No credentials are included.

## Initial prompts and follow-ups

On `create`, prompt input is an initial prompt:

```bash
ez-devbox create --mode ssh-codex --detach --prompt-file ./initial.md --json
printf '%s\n' 'Inspect the failing tests.' | ez-devbox create --mode ssh-claude --detach --prompt-stdin --json
```

On `connect`, prompt input is a follow-up:

```bash
ez-devbox connect --sandbox-id "$SANDBOX_ID" --mode ssh-codex --detach --prompt-file ./follow-up.md --json
```

Files and stdin preserve multiline text and shell metacharacters as data. `web` and `ssh-shell` reject prompt options explicitly.

## Inspect and respond without a PTY

Use the tmux identity returned in `connection`:

```bash
ez-devbox command --sandbox-id "$SANDBOX_ID" -- \
  tmux -L ez-devbox-codex capture-pane -p -S -200 -t ez-devbox-codex

ez-devbox connect --sandbox-id "$SANDBOX_ID" --mode ssh-codex \
  --detach --prompt-file ./response.md --json
```

## Attach with a PTY

```bash
ez-devbox connect --sandbox-id "$SANDBOX_ID" --mode ssh-codex
```

Codex, Claude, and shell sessions detach with `Ctrl+b d`. OpenCode keeps its `Ctrl+C` detach binding. A later `connect` attaches to the same tmux session.

## Reliable remote commands

Normal execution is argv-based:

```bash
ez-devbox command --sandbox-id "$SANDBOX_ID" --timeout-ms 120000 -- \
  printf '%s\n' 'one argument with spaces' '$HOME is literal'
```

Shell evaluation is opt-in:

```bash
ez-devbox command --sandbox-id "$SANDBOX_ID" --shell 'npm test && git status --short'
ez-devbox command --sandbox-id "$SANDBOX_ID" --shell-file ./remote-check.sh --json
```

Completed commands preserve stdout, stderr, and exit status. Transport/startup errors use `{ "error": { "code", "stage", "message", "sandboxId"? } }`.

## Cleanup and concurrency

```bash
ez-devbox wipe --sandbox-id "$SANDBOX_ID"
```

`resume` intentionally uses shared last-run state for the human workflow. Concurrent automation should retain the `sandboxId` returned by `create` and pass it explicitly to every `connect`, `command`, and `wipe` call.
