# SSH Agent Modes Guide (`ssh-opencode`, `ssh-codex`)

Use SSH agent modes when you want an interactive terminal session for OpenCode or Codex inside the sandbox.

## Modes

- `ssh-opencode`: launches OpenCode CLI in the sandbox.
- `ssh-codex`: launches Codex CLI in the sandbox.

## Auth prerequisites (important)

For agent modes to work as expected in sandbox:

- `[opencode].config_dir` and `[opencode].auth_path` must point to valid local OpenCode config/auth files.
- `[codex].config_dir` and `[codex].auth_path` must point to valid local Codex config/auth files.
- Those local auth files must already exist on your machine before `create`.

Example `launcher.config.toml` values (typical macOS/Linux):

```toml
[opencode]
config_dir = "~/.config/opencode"
auth_path = "~/.local/share/opencode/auth.json"

[codex]
config_dir = "~/.codex"
auth_path = "~/.codex/auth.json"
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
