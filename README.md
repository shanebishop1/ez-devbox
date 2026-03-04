# ez-devbox

Run OpenCode/Codex agents in disposable E2B sandboxes with fast reconnects, repeatable repo setup, and your own local toolchain/auth flow.

## What it does

- Creates or connects to an E2B sandbox
- Resumes the last saved sandbox/mode with a single command
- Includes the following modes:
  - `ssh-opencode`
  - `ssh-codex`
  - `web` (starts `opencode serve` and returns URL)
  - `ssh-shell`
- Sets up configured repo(s) during sandbox creation process (clone, branch/checkout, custom bootstrap command)
- Starts tools in the expected directory (`project.working_dir = "auto"` picks repo or workspace)
- Syncs local tool auth/config (OpenCode, Codex, GitHub CLI) into sandbox during `create`
- Supports optional auto-managed local port tunneling for sandbox access of MCP servers, Docker containers, etc.

## Requirements

- Node.js 20+
- `E2B_API_KEY` set in `.env` or shell env
- `launcher.config.toml` available either locally (cwd) or globally (user config dir)
- Docker (and optionally `cloudflared`) installed if you want to use automatic port tunneling with the `[tunnel].ports` config

## Environment variables

You can set variables in your shell or put them in a local `.env` file.

Quick start:

```bash
cp .env.example .env
```

Minimum required:

- `E2B_API_KEY`: required for any real sandbox operation (`create`, `connect`, `list`, `wipe`, live e2e).

Common optional vars:

- `FIRECRAWL_API_URL`: used by your own tooling/workloads inside the sandbox (for example tunneled MCP/API endpoints).
- `FIRECRAWL_API_KEY`: forwarded only if configured through `env.pass_through`.
- `GITHUB_TOKEN` / `GH_TOKEN`: used for GitHub auth flows (especially when `[gh].enabled = true`).
- `OPENCODE_SERVER_PASSWORD`: used for `web` mode auth.

Template file:

- `.env.example` includes the expected keys.

## Install

Use one of these:

```bash
npx ez-devbox --help
```

or

```bash
pnpm dlx ez-devbox --help
```

or

```bash
npm install -g ez-devbox
ez-devbox --help
```

If you are developing this repo locally (not just using the CLI), then run:

```bash
npm install
```

## Quick start

1. Create `.env` and set at least:

```bash
cp .env.example .env
```

```env
E2B_API_KEY=your_key_here
```

2. Load the `.env` values into your shell before running commands:

```bash
set -a && source .env && set +a
```

3. Create/edit `launcher.config.toml`.

Config lookup order:

- Local: `./launcher.config.toml` (from the directory where you run `ez-devbox`)
- Global: user config file
  - macOS/Linux: `~/.config/ez-devbox/launcher.config.toml`
  - Windows: `%APPDATA%\\ez-devbox\\launcher.config.toml`

If neither file exists and you're in an interactive terminal, ez-devbox prompts you to create a starter config locally or globally, then continues with it. In non-interactive environments, it exits with an error listing both expected paths.

If you do not already have one, create a starter config:

```bash
cat > launcher.config.toml <<'EOF'
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
EOF
```

Then set each repo's `setup_command` as needed. For the full field reference, see `docs/launcher-config-reference.md`.

4. Run commands (`npx` if not globally installed):

```bash
npx ez-devbox create
npx ez-devbox connect
```

## Common commands

Use `npx ez-devbox ...` if the CLI is not globally installed.

- Show CLI help:
  - `ez-devbox --help`
- Create with explicit mode:
  - `ez-devbox create --mode web`
- Connect to specific sandbox:
  - `ez-devbox connect --sandbox-id <sandbox-id>`
- Resume last saved sandbox + mode:
  - `ez-devbox resume`
  - Reuses the last selected repo for that sandbox when `project.active = "prompt"` and the repo still exists.
- Enable verbose startup/provisioning logs:
  - `ez-devbox create --verbose`
  - `ez-devbox connect --verbose`
- List available sandboxes:
  - `ez-devbox list`
- Machine-readable JSON output (automation):
  - `ez-devbox list --json`
  - `ez-devbox command --sandbox-id <sandbox-id> --json -- pwd`
  - `ez-devbox create --mode web --json`
  - `ez-devbox connect --mode web --json`
- Wipe one sandbox (interactive picker or `--sandbox-id`):
  - `ez-devbox wipe`
- Wipe all sandboxes (use `--yes` in non-interactive terminals):
  - `ez-devbox wipe-all --yes`

## JSON output contracts

Use `--json` on automation-facing commands for stable machine-readable output:

- `list`: `{ "sandboxes": [...] }`
- `command`: command result envelope (`sandboxId`, `command`, `cwd`, `stdout`, `stderr`, `exitCode`)
- `create` / `connect`: launch result envelope (mode, command/url when present, workingDirectory, setup summary)

Tip: optional fields are omitted when undefined (for example `url` is absent for SSH modes).

## Verbose mode

- Use `--verbose` to show detailed operational logs during `create/connect` (startup mode resolution, sandbox lifecycle steps, create-time tooling sync progress, bootstrap progress, SSH/tunnel setup details).
- Interactive pickers/prompts still show as normal.
- Without `--verbose`, ez-devbox keeps output focused on prompts and final command results.

## Config files

- `launcher.config.toml`: ez-devbox behavior (sandbox, startup, project, env pass-through, tooling auth sync, tunnel). Resolved from local-first then global fallback.
- `.env`: secrets and local env values
- last-run state: by default stored at `${TMPDIR}/ez-devbox/last-run/cwd-state/<sha1(cwd)>/.ez-devbox-last-run.json` (legacy `.agent-box-last-run.json` in the current directory is still read as a fallback)
- `docs/launcher-config-reference.md`: full `launcher.config.toml` field reference

### Tunnel targets

For non-local upstream services, define explicit tunnel targets (port -> upstream URL):

```toml
[tunnel]

[tunnel.targets]
"3002" = "http://10.0.0.20:3002"
```

This keeps the same `EZ_DEVBOX_TUNNEL_*` env output while pointing cloudflared at a remote host/service.
When `tunnel.targets` is present, its keys are the authoritative tunneled ports (you do not need `tunnel.ports`).
Target URLs cannot include credentials, path, query, or fragment.
On `create`, ez-devbox prints a warning that tunnel URLs are effectively bearer links: anyone with the URL can reach the forwarded service.

## Troubleshooting

- `authorization header is missing` / 401 errors:
  - your shell likely does not have `E2B_API_KEY` loaded.
  - `set -a && source .env && set +a` (bash/zsh) before running CLI commands.
- `wipe-all requires --yes in non-interactive terminals`:
  - add `--yes` in CI/scripts.
- Multiple sandboxes in non-interactive runs:
  - pass `--sandbox-id <id>` explicitly.
- Tunnel command issues:
  - ensure `cloudflared` is installed, or Docker is available for fallback.

## launcher.config.toml reference

See `docs/launcher-config-reference.md`.
