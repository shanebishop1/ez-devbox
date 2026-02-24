# ez-devbox

Lightweight TypeScript CLI for creating, reconnecting, and launching E2B coding sandboxes.

## What it does

- Creates or connects to an E2B sandbox
- Resumes the last saved sandbox/mode with a single command
- Launches one startup mode:
  - `ssh-opencode`
  - `ssh-codex`
  - `web` (starts `opencode serve` and returns URL)
  - `ssh-shell`
  - `prompt` (interactive chooser in TTY; non-interactive fallback to `ssh-opencode`)
- Persists last-run state locally so reconnects are fast
- Bootstraps configured repos on create/connect (clone, branch checkout, setup command)
- Starts tools in the expected directory (`project.working_dir = "auto"` picks repo or workspace)
- Optionally syncs local tool auth/config (OpenCode, Codex, GitHub CLI) into sandbox during `create`
- Supports optional auto-managed local port tunneling for sandbox access

## Requirements

- Node.js 20+
- npm
- `E2B_API_KEY` set in `.env` or shell env
- `cloudflared` installed (or Docker available for fallback) if `[tunnel].ports` is enabled

## Install

```bash
npm install -g ez-devbox
```

Then run:

```bash
ez-devbox --help
```

## Quick start

1. Install local deps:

```bash
npm install
```

2. Create `.env` (or copy from `.env.example`) and set at least:

```env
E2B_API_KEY=your_key_here
```

3. Review `launcher.config.toml` and set each repo's `setup_command` (primary setup step).

4. Run commands:

```bash
npm run create
npm run connect
# or, once installed from npm:
ez-devbox create
ez-devbox connect
```

## Common commands

- Show CLI help:
  - `ez-devbox --help`
  - `npm run dev -- --help`
- Create with explicit mode:
  - `ez-devbox create -- --mode web`
  - `npm run create -- --mode web`
- Connect to specific sandbox:
  - `ez-devbox connect -- --sandbox-id <sandbox-id>`
  - `npm run connect -- --sandbox-id <sandbox-id>`
- Resume last saved sandbox + mode:
  - `ez-devbox resume`
  - `npm run resume`
  - Reuses the last selected repo for that sandbox when `project.active = "prompt"` and the repo still exists.
- Enable verbose startup/provisioning logs:
  - `ez-devbox create -- --verbose`
  - `ez-devbox connect -- --verbose`
  - `npm run connect -- --verbose`
- List available sandboxes:
  - `ez-devbox list`
  - `npm run list`
- Wipe one sandbox (interactive picker or `--sandbox-id`):
  - `ez-devbox wipe`
  - `npm run wipe`
- Wipe all sandboxes (use `--yes` in non-interactive terminals):
  - `ez-devbox wipe-all -- --yes`
  - `npm run wipe-all -- --yes`

## Verbose mode

- Use `--verbose` to show detailed operational logs during `create/connect` (startup mode resolution, sandbox lifecycle steps, create-time tooling sync progress, bootstrap progress, SSH/tunnel setup details).
- Interactive pickers/prompts still show as normal.
- Without `--verbose`, ez-devbox keeps output focused on prompts and final command results.

## Config files

- `launcher.config.toml`: ez-devbox behavior (sandbox, startup, project, env pass-through, tooling auth sync, tunnel)
- `.env`: secrets and local env values
- `.ez-devbox-last-run.json`: auto-generated local state for reconnects (legacy `.agent-box-last-run.json` is still read as a fallback)

## launcher.config.toml reference

### `[sandbox]`

- `template` (string): E2B template slug used when creating new sandboxes.
- `reuse` (boolean): currently reserved for reuse policy and not used to change runtime behavior.
- `name` (string): base display name prefix used in launcher metadata.
- `timeout_ms` (number): sandbox timeout in milliseconds; must be a positive integer.
- `delete_on_exit` (boolean): currently reserved and not used to change runtime behavior.

### `[startup]`

- `mode` (enum): default startup mode. Allowed values: `prompt|ssh-opencode|ssh-codex|web|ssh-shell`.
- `prompt` behavior: prompts in interactive terminals (accepts `1-4` or mode name); non-interactive fallback is `ssh-opencode`.

### `[project]`

- `mode` (enum): repo selection strategy. Allowed values: `single|all`.
- `active` (enum): single-repo chooser mode. Allowed values: `prompt|name|index`.
  - `prompt` asks which repo to use when multiple repos are configured and a TTY is available.
  - `name` and `index` are accepted config values, but current behavior falls back to the first configured repo.
- `dir` (string): parent workspace directory in the sandbox where repos are cloned.
- `working_dir` (string): launch cwd policy.
  - `auto` (default): one selected/provisioned repo -> repo path, multiple repos -> `project.dir`, no repo -> unchanged.
  - any non-empty path string: used as launch cwd; relative paths resolve under `project.dir`.
- `setup_on_connect` (boolean): when `true`, setup runs on `connect` even for already-cloned repos.
- `setup_retries` (number): retry count for `setup_command` after the first attempt (total attempts = `setup_retries + 1`).
- `setup_continue_on_error` (boolean): when `true`, continue setup for other repos after a failure.
- `[[project.repos]]`: list of repos to clone/checkout/bootstrap.
  - `name` (string): repo folder name under `project.dir`.
  - `url` (string): git clone URL.
  - `branch` (string): branch to checkout (defaults to `main` if omitted).
  - `setup_command` (string): primary setup command users should configure.
  - `setup_env` (table): string env vars injected into setup commands.
  - `startup_env` (table): string env vars injected into launched startup mode only when exactly one repo is selected.

Setup for each selected repo runs `setup_command`.

If `create` is cancelled during interactive repo selection, ez-devbox automatically wipes the newly created sandbox.

When `project.working_dir = "auto"`, working directory behavior after repo selection/provisioning is:

- one selected repo: launch in that repo directory (`project.dir/<repo-name>`)
- multiple selected repos: launch in parent project directory (`project.dir`)

### `[env]`

- `pass_through` (string array): extra host env var names to forward into sandbox creation.
- Built-in pass-through vars are always considered as well: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `GH_TOKEN`, `OPENCODE_SERVER_PASSWORD`.
- Add service-specific keys (for example Firecrawl) explicitly in `pass_through`.

### `[opencode]`

- `config_dir` (string): host OpenCode config directory to sync into `/home/user/.config/opencode` in sandbox.
- `auth_path` (string): host OpenCode auth file to sync into `/home/user/.local/share/opencode/auth.json` in sandbox.

### `[codex]`

- `config_dir` (string): host Codex config directory to sync into `/home/user/.codex` in sandbox.
- `auth_path` (string): host Codex auth file to sync into `/home/user/.codex/auth.json` in sandbox.

### `[gh]`

- `enabled` (boolean): enables GitHub CLI config sync into the sandbox and GitHub auth token injection for bootstrap/launch runtime (`GH_TOKEN` -> `GITHUB_TOKEN` -> `gh auth token`). Default: `false` (off).
- `config_dir` (string): host GitHub CLI config directory to sync into `/home/user/.config/gh` in sandbox when enabled.

### `[tunnel]`

- `ports` (number array): local TCP ports to expose with temporary cloudflared tunnels.
  - `[]` disables tunnel management.
  - Each value `1-65535` starts one tunnel to `http://127.0.0.1:<port>` for `create/connect/start/command`.
  - Runtime exports generic env vars: `EZ_DEVBOX_TUNNEL_<PORT>_URL`, `EZ_DEVBOX_TUNNELS_JSON`, and `EZ_DEVBOX_TUNNEL_PORTS`; `EZ_DEVBOX_TUNNEL_URL` is set only when exactly one tunnel is active.
  - Runtime prefers local `cloudflared`; if missing, it falls back to `docker run cloudflare/cloudflared:latest`.

## Dev checks

```bash
npm run test
npm run build
```
