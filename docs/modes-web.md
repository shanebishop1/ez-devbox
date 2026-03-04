# Web Mode Guide (`--mode web`)

Use web mode when you want a browser URL to an OpenCode server running inside the sandbox.

## What this mode does

- Starts/uses a sandbox.
- Bootstraps your configured repos.
- Launches OpenCode web server in the sandbox.
- Returns a URL you can open.

## Step-by-step

1. Make sure `.env` is loaded:

```bash
set -a && source .env && set +a
```

2. Create and launch in web mode:

```bash
npx ez-devbox create --mode web
```

3. Open the URL from command output.

4. Reconnect to the same sandbox in web mode later:

```bash
npx ez-devbox connect --mode web --sandbox-id <sandbox-id>
```

## Auth for web mode

- If `OPENCODE_SERVER_PASSWORD` is set in your env, ez-devbox injects it for web mode startup.
- This protects the web endpoint with OpenCode server auth.

## Prompt behavior

If you run `create`/`connect` with `--mode prompt` (or `startup.mode = "prompt"`):

- You see: `Select startup mode` with choices `ssh-opencode`, `ssh-codex`, `web`, `ssh-shell`.
- Enter either the number (`1-4`) or the mode name.
- In non-interactive terminals, prompt mode falls back to `ssh-opencode`.

## Useful flags for web workflows

- `--mode web`: force web mode.
- `--sandbox-id <id>`: target a specific sandbox (connect).
- `--json`: machine-readable output (`create`/`connect`).
- `--verbose`: detailed startup/bootstrap logs.

## Quick examples

Create web sandbox with JSON output:

```bash
npx ez-devbox create --mode web --json
```

Connect web mode to an existing sandbox:

```bash
npx ez-devbox connect --mode web --sandbox-id <sandbox-id>
```
