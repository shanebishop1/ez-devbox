# SSH Agent Modes Guide (`ssh-opencode`, `ssh-codex`, `ssh-claude`)

Use SSH agent modes when you want an interactive terminal session for OpenCode, Codex, or Claude inside the sandbox.

## Modes

- `ssh-opencode`: starts/uses a persistent OpenCode server (`opencode serve`) in the sandbox, then attaches the TUI client over SSH (`opencode attach`) inside a persistent `tmux` session.
- `ssh-codex`: launches Codex CLI in the sandbox inside a persistent `tmux` session.
- `ssh-claude`: launches Claude Code CLI in the sandbox inside a persistent `tmux` session.

### `ssh-opencode` persistence behavior

- The OpenCode backend process is decoupled from your SSH attach session.
- If your SSH session disconnects or you exit attach, the backend keeps running while the sandbox is alive.
- Re-running `connect --mode ssh-opencode` re-attaches a new TUI client to that running backend.

### `ssh-codex` persistence behavior

- Codex runs inside a named in-sandbox `tmux` session.
- If your SSH session disconnects, the Codex process keeps running while the sandbox is alive.
- Re-running `connect --mode ssh-codex` or `resume` re-attaches to that same Codex session.

### `ssh-claude` persistence behavior

- Claude Code runs inside a named in-sandbox `tmux` session.
- If your SSH session disconnects, the Claude process keeps running while the sandbox is alive.
- Re-running `connect --mode ssh-claude` or `resume` re-attaches to that same Claude session.

### Detaching intentionally

- `ssh-opencode`: `Ctrl+C` detaches your terminal while keeping the in-sandbox session alive.
- `ssh-codex`: use tmux detach (`Ctrl+b d`) to leave the session running.
- `ssh-claude`: use tmux detach (`Ctrl+b d`) to leave the session running.

## Auth prerequisites (important)

For agent modes to work as expected in sandbox:

- `[opencode].config_dir` and `[opencode].auth_path` must point to valid local OpenCode config/auth files.
- `[codex].config_dir` and `[codex].auth_path` must point to valid local Codex config/auth files.
- `[claude].config_dir` and `[claude].state_path` should point to your local Claude CLI config/state files when you want auth continuity.
- Those local auth files must already exist on your machine before `create`.
- Claude login is browser-driven. In remote SSH workflows, browser prompts can open on the wrong machine; if sync is unavailable, run `claude` in the sandbox and complete `/login` manually.

Example `ez-devbox.config.toml` values (typical macOS/Linux):

```toml
[opencode]
config_dir = "~/.config/opencode"
auth_path = "~/.local/share/opencode/auth.json"

[codex]
config_dir = "~/.codex"
auth_path = "~/.codex/auth.json"

[claude]
config_dir = "~/.claude"
state_path = "~/.claude.json"
```

ez-devbox syncs those host files into sandbox during `create`.
If they are missing/invalid locally, the corresponding CLI mode can start but not be authenticated.

## Step-by-step

1. Ensure `.env` exists with `E2B_API_KEY` set.

2. Pick one mode and stay on that mode for reconnects.

OpenCode flow:

```bash
npx ez-devbox create --mode ssh-opencode
npx ez-devbox connect --sandbox-id <sandbox-id> --mode ssh-opencode
```

Codex flow:

```bash
npx ez-devbox create --mode ssh-codex
npx ez-devbox connect --sandbox-id <sandbox-id> --mode ssh-codex
```

Claude flow:

```bash
npx ez-devbox create --mode ssh-claude
npx ez-devbox connect --sandbox-id <sandbox-id> --mode ssh-claude
```

3. Resume the last saved sandbox/mode:

```bash
npx ez-devbox resume
```

## Quick examples

OpenCode create/connect:

```bash
npx ez-devbox create --mode ssh-opencode
npx ez-devbox connect --sandbox-id <sandbox-id> --mode ssh-opencode
```

Codex create/connect:

```bash
npx ez-devbox create --mode ssh-codex
npx ez-devbox connect --sandbox-id <sandbox-id> --mode ssh-codex
```

Claude create/connect:

```bash
npx ez-devbox create --mode ssh-claude
npx ez-devbox connect --sandbox-id <sandbox-id> --mode ssh-claude
```
