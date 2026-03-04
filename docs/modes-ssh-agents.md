# SSH Agent Modes Guide (`ssh-opencode`, `ssh-codex`)

Use SSH agent modes when you want an interactive terminal session for OpenCode or Codex inside the sandbox.

## Modes

- `ssh-opencode`: launches OpenCode CLI in the sandbox.
- `ssh-codex`: launches Codex CLI in the sandbox.

## Step-by-step

1. Make sure `.env` is loaded:

```bash
set -a && source .env && set +a
```

2. Create and launch OpenCode mode:

```bash
npx ez-devbox create --mode ssh-opencode
```

3. Create and launch Codex mode:

```bash
npx ez-devbox create --mode ssh-codex
```

4. Reconnect later to a specific sandbox and mode:

```bash
npx ez-devbox connect --sandbox-id <sandbox-id> --mode ssh-opencode
npx ez-devbox connect --sandbox-id <sandbox-id> --mode ssh-codex
```

## Prompt behavior

If you use prompt mode:

- Startup prompt asks for one of: `ssh-opencode`, `ssh-codex`, `web`, `ssh-shell`.
- Accepts numeric choice (`1-4`) or mode name.
- After 3 invalid attempts, the command exits with an error.
- In non-interactive terminals, prompt mode falls back to `ssh-opencode`.

## Useful flags

For `create`:

- `--mode <mode>`: `prompt|ssh-opencode|ssh-codex|web|ssh-shell`
- `--json`
- `--verbose`

For `connect`:

- `--sandbox-id <id>`
- `--mode <mode>`
- `--json`
- `--verbose`

## Quick examples

Create with Codex and structured output:

```bash
npx ez-devbox create --mode ssh-codex --json
```

Connect with OpenCode and verbose logs:

```bash
npx ez-devbox connect --sandbox-id <sandbox-id> --mode ssh-opencode --verbose
```
