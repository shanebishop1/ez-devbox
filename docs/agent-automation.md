# Agent and automation usage

`ez-devbox` keeps a persistent agent/tmux session in an E2B sandbox. Built-in OpenCode, Codex, and Claude modes remain convenient presets; `ssh-custom` lets one project config supply another terminal agent without a plugin framework.

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

For a custom agent, configure `agent.initial_prompt_command` with `{prompt}` as a whole argv element, then use the same flow:

```bash
printf '%s\n' 'Inspect the failing tests.' | ez-devbox create --mode ssh-custom --detach --prompt-stdin --json
```

On `connect`, prompt input is a follow-up:

```bash
ez-devbox connect --sandbox-id "$SANDBOX_ID" --mode ssh-codex --detach --prompt-file ./follow-up.md --json
```

Files and stdin preserve multiline text and shell metacharacters as data. `web` and `ssh-shell` reject prompt options explicitly. Custom initial prompts require `agent.initial_prompt_command`; custom follow-ups require `agent.follow_up = "tmux"`.

## Inspect and respond without a PTY

Use the tmux identity returned in `connection`:

```bash
ez-devbox command --sandbox-id "$SANDBOX_ID" -- \
  tmux -L ez-devbox-codex capture-pane -p -S -200 -t ez-devbox-codex

ez-devbox connect --sandbox-id "$SANDBOX_ID" --mode ssh-codex \
  --detach --prompt-file ./response.md --json
```

Replace `ssh-codex` with `ssh-custom` when the custom definition enables tmux follow-ups. Use the returned `connection.sessionName`/`socketName` rather than assuming the custom identity.

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

`resume` uses shared last-run state. For concurrent automation, pass the `sandboxId` returned by `create` to every `connect`, `command`, and `wipe` call.

Custom agent installation/check commands run in the sandbox, independently of repository setup, and custom file mappings sync on `create` only. `lifecycle.agent: ready` means the persistent session started; it does not prove provider authentication or task completion.
