# Web Mode Guide (`--mode web`)

Use web mode when you want a browser URL to an OpenCode server running inside the sandbox.

## What this mode does

- Starts/uses a sandbox.
- Bootstraps your configured repos.
- Launches OpenCode web server in the sandbox.
- Returns a URL you can open.

## Auth prerequisites (important)

For web mode to be usable in sandbox:

- Your `ez-devbox.config.toml` must point `[opencode].config_dir` and `[opencode].auth_path` to valid local OpenCode config/auth paths.
- Those local OpenCode auth/config files must already exist on your machine.
- A nonempty `OPENCODE_SERVER_PASSWORD` must be available in the sandbox before web mode starts a new public listener. The usual host-side setup is to set it in `.env`.

Example `ez-devbox.config.toml` values (typical macOS/Linux):

```toml
[opencode]
config_dir = "~/.config/opencode"
auth_path = "~/.local/share/opencode/auth.json"
```

ez-devbox syncs OpenCode config/auth from host to sandbox during `create`, then starts `opencode serve`.
If auth/config is missing locally, web startup can fail or open without your expected auth state.

## Step-by-step

1. Ensure `.env` exists with `E2B_API_KEY` set.

2. Create and launch in web mode:

```bash
npx ez-devbox create --mode web
```

3. Open the URL from command output.

4. Later, reopen your most recent sandbox/mode quickly:

```bash
npx ez-devbox resume
```

## Auth for web mode

- For a new listener, ez-devbox checks the effective sandbox environment before starting `opencode serve` and verifies that the endpoint returns `401`.
- If an already-running listener returns `401`, ez-devbox reuses it without requiring the host password again.
- An existing listener that does not return `401` is rejected and is neither reused nor stopped. This includes an unauthenticated listener inherited from a pre-provisioned template (normally HTTP `200`). Stop that listener yourself inside the sandbox, remove it from the template, or use another sandbox before retrying.
- If `OPENCODE_SERVER_PASSWORD` is set in your host env, ez-devbox injects it for web mode startup. An inherited nonempty sandbox value also satisfies the prerequisite.
- If a newly started listener fails readiness or authentication verification, ez-devbox stops it only after matching the per-launch ownership tag. If ownership cannot be verified, startup fails with instructions to inspect port 3000 instead of killing an unknown process.

## Quick examples

Create web sandbox:

```bash
npx ez-devbox create --mode web
```
