# SSH Agent Modes Guide (`ssh-opencode`, `ssh-codex`)

Use SSH agent modes when you want an interactive terminal session for OpenCode or Codex inside the sandbox.

## Modes

- `ssh-opencode`: launches OpenCode CLI in the sandbox.
- `ssh-codex`: launches Codex CLI in the sandbox.

## Step-by-step

1. Ensure `.env` exists with `E2B_API_KEY` set.

2. Create and launch one mode:
OpenCode mode:

```bash
npx ez-devbox create --mode ssh-opencode
```

Codex mode:

```bash
npx ez-devbox create --mode ssh-codex
```

3. Reconnect to a specific sandbox and mode:

```bash
npx ez-devbox connect --sandbox-id <sandbox-id> --mode ssh-opencode
npx ez-devbox connect --sandbox-id <sandbox-id> --mode ssh-codex
```

4. Resume the last saved sandbox/mode:

```bash
npx ez-devbox resume
```

## Quick examples

Create with Codex:

```bash
npx ez-devbox create --mode ssh-codex
```

Connect with OpenCode:

```bash
npx ez-devbox connect --sandbox-id <sandbox-id> --mode ssh-opencode
```
