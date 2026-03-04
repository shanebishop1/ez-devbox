# Web Mode Guide (`--mode web`)

Use web mode when you want a browser URL to an OpenCode server running inside the sandbox.

## What this mode does

- Starts/uses a sandbox.
- Bootstraps your configured repos.
- Launches OpenCode web server in the sandbox.
- Returns a URL you can open.

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

- If `OPENCODE_SERVER_PASSWORD` is set in your env, ez-devbox injects it for web mode startup.
- This protects the web endpoint with OpenCode server auth.

## Quick examples

Create web sandbox:

```bash
npx ez-devbox create --mode web
```
