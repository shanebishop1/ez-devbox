# Remote commands

## Execute

`command` runs through the E2B SDK without SSH or a PTY, independently of the running agent. Default execution preserves argv boundaries:

```bash
ez-devbox command --sandbox-id "$SANDBOX_ID" --timeout-ms 120000 -- printf '%s\n' 'a b' '$HOME'
```

Use explicit shell mode only for operators, expansion, or a script:

```bash
ez-devbox command --sandbox-id "$SANDBOX_ID" --shell 'npm test && git status --short'
ez-devbox command --sandbox-id "$SANDBOX_ID" --shell-file ./remote-check.sh --json
```

JSON returns `sandboxId`, `cwd`, a command description, `stdout`, `stderr`, and `exitCode`; the CLI preserves the remote exit status, including nonzero results. The timeout applies to this command, not sandbox lifetime.

Commands use the configured workspace/repo. With multiple repos in single/prompt mode, noninteractive selection requires valid saved repository state matching the target sandbox; otherwise configure `project.active = "name"` and `active_name`. For a different directory, use explicit shell mode, e.g. `--shell 'cd /home/user/projects/workspace/your-repo && git status --short'`.

## Inspect an agent

Set `TMUX_SOCKET` and `TMUX_SESSION` from the launch JSON's `connection.socketName` and `connection.sessionName`, not guessed defaults:

```bash
ez-devbox command --sandbox-id "$SANDBOX_ID" -- \
  tmux -L "$TMUX_SOCKET" capture-pane -p -S -200 -t "$TMUX_SESSION"
```

Alternatively, run the returned `connection.captureCommand` using `command --shell`. This reads recent terminal output, not a structured agent result. Send conversation text with `connect --detach --prompt-file ...`; use targeted `tmux send-keys` only when an inspected interactive menu requires a key, not to interpolate arbitrary prompt text.

For `ssh-custom`, follow-ups require `agent.follow_up = "tmux"`. Keep the same agent configuration when reconnecting: a different configuration fingerprint is rejected rather than replacing the running process. Capture output before deciding whether to stop a session, and preserve useful work before wiping its sandbox.

## Diagnose

Transport/startup failures return `{ "error": { "code", "stage", "message", "sandboxId"? } }` with `--json`. Preserve the ID for recovery; do not blindly retry `create` and accumulate sandboxes. Add `--verbose` for startup details.

- Missing config: run from the directory containing `ez-devbox.config.toml`, or use the global path in [setup](setup.md).
- E2B 401: check host `E2B_API_KEY`; agent login errors instead concern provider credentials or create-time auth sync.
- Missing/expired sandbox: check `list --json`, then create a replacement if needed.
- Agent waiting for input: inspect its pane, then send a follow-up or attach from a PTY.
