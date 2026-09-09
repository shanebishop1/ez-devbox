# Sessions

## Create and find

After [setup](setup.md), run from the same project directory:

```bash
ez-devbox create --mode ssh-opencode --detach --json
ez-devbox list --json
```

Save the returned `sandboxId` as `SANDBOX_ID` in your shell; retain `mode`, `workingDirectory`, and `connection` too. `list --json` returns `{ "sandboxes": [...] }`. Use it to discover existing IDs instead of creating duplicate devboxes.

Modes: `ssh-opencode`, `ssh-codex`, `ssh-claude`, `ssh-shell`, or `web`. `create` provisions a new sandbox; `connect` launches/reuses a session in an existing one. Prefer the same agent mode on reconnect: changing modes does not transfer conversations or resync the new agent's host credentials.

## Prompt and inspect

Use `--prompt-file PATH` for an initial prompt, or `--prompt-stdin` with piped input. Files are local and preserve multiline text/metacharacters as data. On `connect`, these flags send a follow-up to the existing conversation; choose only one prompt source.

```bash
ez-devbox create --mode ssh-codex --detach --prompt-file task.md --json
ez-devbox connect --sandbox-id "$SANDBOX_ID" --mode ssh-codex --detach --prompt-stdin --json < follow-up.md
```

`prompt.delivered` confirms input delivery, not task completion. Inspect progress with the tmux commands in [commands](commands.md); poll at sensible intervals and respond through detached `connect`. Prompt input is unsupported for `web` and `ssh-shell`.

## Attach or open a shell

```bash
ez-devbox connect --sandbox-id "$SANDBOX_ID" --mode ssh-codex
ez-devbox connect --sandbox-id "$SANDBOX_ID" --mode ssh-shell
ez-devbox resume
```

SSH attachment needs a PTY and local `ssh`; the CLI manages the bridge, so do not guess an SSH hostname/key. Without a PTY, use `--detach --json` and remote `command` instead. Codex, Claude, and shell detach with `Ctrl+b d`; OpenCode uses `Ctrl+C`. `resume` reconnects to the last saved sandbox/mode for this project directory, which may now be the shell; use explicit ID/mode for automation.

## Browser access

Set `OPENCODE_SERVER_PASSWORD` as described in [setup](setup.md), then:

```bash
ez-devbox create --mode web --json
# Or reuse a devbox:
ez-devbox connect --sandbox-id "$SANDBOX_ID" --mode web --json
```

Open the returned `url` (`connection.endpoint`) and authenticate with username `opencode` and the configured password. An existing authenticated listener retains its original password. An unauthenticated existing listener is refused: stop it deliberately from the sandbox shell or use a new sandbox; merely changing the host password does not secure that process.

## Preserve and delete

Commit/push or otherwise export needed remote work before deletion or timeout; changes are not automatically copied back to the host. Confirm the target/scope before destructive operations:

```bash
ez-devbox wipe --sandbox-id "$SANDBOX_ID"
ez-devbox list --json
# Only when deleting ALL available sandboxes is intended:
ez-devbox wipe-all --yes
```

Exit/detach does not delete a sandbox. The configured timeout starts at creation and is not reset by reconnect. Most failed creates also retain the sandbox; use the error's `sandboxId` to inspect, reconnect, or wipe it. An expired/deleted sandbox cannot be resumed; create a new one.
