# Sessions

Create and wait for the persistent agent session:

```bash
ez-devbox create --mode ssh-opencode --detach --json
```

Use `--prompt-file PATH` for an initial prompt, or `--prompt-stdin` with piped input. On `connect`, the same flags mean a follow-up to the existing conversation.

```bash
ez-devbox create --mode ssh-codex --detach --prompt-file task.md --json
ez-devbox connect --sandbox-id "$SANDBOX_ID" --mode ssh-codex --detach --prompt-stdin --json < follow-up.md
```

Attach from a PTY with `connect --sandbox-id ID --mode MODE`. Without a PTY, capture the returned tmux session and send follow-ups through detached `connect`:

```bash
ez-devbox command --sandbox-id "$SANDBOX_ID" -- tmux -L ez-devbox-codex capture-pane -p -S -200 -t ez-devbox-codex
ez-devbox wipe --sandbox-id "$SANDBOX_ID"
```

Prompt input is unsupported for `web` and `ssh-shell`.
