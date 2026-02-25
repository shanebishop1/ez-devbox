# launcher.config.toml reference

ez-devbox resolves config in this order:

1. Local `./launcher.config.toml` (current working directory)
2. Global user config `launcher.config.toml`
   - macOS/Linux: `~/.config/ez-devbox/launcher.config.toml`
   - Windows: `%APPDATA%\\ez-devbox\\launcher.config.toml`

If neither file exists and a TTY is available, ez-devbox prompts to create a starter config locally or globally.

## Starter config

Copy/paste this starter file into `launcher.config.toml` if you are setting up a new workspace:

```toml
[sandbox]
template = "opencode"
name = "ez-devbox"

[project]
mode = "single"
active = "prompt"

[[project.repos]]
name = "your-repo"
url = "https://github.com/your-org/your-repo.git"
setup_command = "npm install"
```

## `[sandbox]`

- `template` (string): E2B template slug used when creating new sandboxes.
- `reuse` (boolean): currently reserved for reuse policy and not used to change runtime behavior.
- `name` (string): base display name prefix used in launcher metadata.
- `timeout_ms` (number): sandbox timeout in milliseconds; must be a positive integer.
- `delete_on_exit` (boolean): currently reserved and not used to change runtime behavior.

## `[startup]`

- `mode` (enum): default startup mode. Allowed values: `prompt|ssh-opencode|ssh-codex|web|ssh-shell`.
- `prompt` behavior: prompts in interactive terminals (accepts `1-4` or mode name); non-interactive fallback is `ssh-opencode`.

## `[project]`

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

## `[env]`

- `pass_through` (string array): extra host env var names to forward into sandbox creation.
- Built-in pass-through vars are always considered as well: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `GH_TOKEN`.
- `OPENCODE_SERVER_PASSWORD` is scoped to web startup: ez-devbox injects it only when launching `startup.mode = "web"` (or `--mode web`).
- Add service-specific keys (for example Firecrawl) explicitly in `pass_through`.

## `[opencode]`

- `config_dir` (string): host OpenCode config directory to sync into `/home/user/.config/opencode` in sandbox.
- `auth_path` (string): host OpenCode auth file to sync into `/home/user/.local/share/opencode/auth.json` in sandbox.

## `[codex]`

- `config_dir` (string): host Codex config directory to sync into `/home/user/.codex` in sandbox.
- `auth_path` (string): host Codex auth file to sync into `/home/user/.codex/auth.json` in sandbox.

## `[gh]`

- `enabled` (boolean): enables GitHub CLI config sync into the sandbox and GitHub auth token injection for bootstrap/launch runtime (`GH_TOKEN` -> `GITHUB_TOKEN` -> `gh auth token`). Default: `false` (off).
- `config_dir` (string): host GitHub CLI config directory to sync into `/home/user/.config/gh` in sandbox when enabled. Auth-state files that trigger host keyring migration (`hosts.yml`) are intentionally excluded; sandbox GitHub auth still comes from injected `GH_TOKEN`/`GITHUB_TOKEN`.

## `[tunnel]`

- `ports` (number array): local TCP ports to expose with temporary cloudflared tunnels.
- `[]` disables tunnel management.
- Each value `1-65535` starts one tunnel to `http://127.0.0.1:<port>` for `create/connect/start/command`.
- Runtime exports generic env vars: `EZ_DEVBOX_TUNNEL_<PORT>_URL`, `EZ_DEVBOX_TUNNELS_JSON`, and `EZ_DEVBOX_TUNNEL_PORTS`; `EZ_DEVBOX_TUNNEL_URL` is set only when exactly one tunnel is active.
- Runtime prefers local `cloudflared`; if missing, it falls back to `docker run cloudflare/cloudflared:2024.11.0`.
