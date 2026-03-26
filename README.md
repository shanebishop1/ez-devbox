# 🤖 ez-devbox 📦

Run OpenCode, Codex, and Claude Code agents in disposable E2B sandboxes with fast reconnects, repeatable repo setup, and your own local toolchain/auth flow.

## What it does

- Creates or connects to an E2B sandbox
- Includes the following modes:
  - `ssh-opencode` (ssh + attach OpenCode TUI to a persistent in-sandbox `opencode serve` backend; leaving the session detaches and reconnect/resume re-attaches to the same in-sandbox session)
  - `ssh-codex` (ssh + attach Codex inside a persistent in-sandbox `tmux` session)
  - `ssh-claude` (ssh + attach Claude Code inside a persistent in-sandbox `tmux` session)
  - `web` (starts `opencode serve` and returns URL)
  - `ssh-shell` (interactive shell inside a persistent in-sandbox `tmux` session)
- Automatic repo set-up/bootstrapping during sandbox creation (clone, branch, set up environment, install packages, initialize, etc.)
- Starts tools in the expected directory (`project.working_dir = "auto"` picks repo or workspace)
- Syncs local tool auth/config (OpenCode, Codex, Claude Code, GitHub CLI) into sandbox during `create`
- Supports optional auto-managed port tunneling for sandbox access to your local MCP servers, Docker containers, etc.

## Why This Approach

This tool is for a workflow where you want disposable cloud sandboxes without giving up local control over setup and credentials:

- Repeatable repo bootstrapping on sandbox creation, instead of manual shell setup each time.
- Fast reconnect/resume behavior with saved sandbox + mode state.
- SSH modes are persistent: disconnecting detaches while the sandbox keeps the session alive, and reconnect/resume attaches you back to it.
- Controlled env pass-through and auth/config sync (OpenCode/Codex/Claude Code/GitHub) rather than ad-hoc copying.
- Optional local port tunnel mapping for MCP servers and local services.

## Install

Prereqs: Node.js 20+, `E2B_API_KEY`, and a `launcher.config.toml` (local or global). Docker/`cloudflared` only if you use tunnel features.

Choose one:

```bash
npm install --save-dev ez-devbox
npx ez-devbox --help
```

or one-off run without install:

```bash
npx ez-devbox --help
```

or global install:

```bash
npm install -g ez-devbox
ez-devbox --help
```

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

## Quick start

1. Create `.env` and set at least:

```bash
cp .env.example .env
```

```env
E2B_API_KEY=your_key_here
```

2. Create/edit `launcher.config.toml`.

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

3. Run commands (`npx` if not globally installed):

```bash
npx ez-devbox create
npx ez-devbox connect
```

## Mode guides

- [Web mode (OpenCode in browser)](docs/modes-web.md)
- [SSH agent modes (OpenCode, Codex, and Claude Code)](docs/modes-ssh-agents.md)

## Common commands

Use `npx ez-devbox ...` if the CLI is not globally installed.

| Goal | Command |
| --- | --- |
| Help | `ez-devbox --help` |
| Create sandbox + launch mode | `ez-devbox create --mode web` |
| List sandboxes | `ez-devbox list` |
| Connect to existing sandbox | `ez-devbox connect --sandbox-id <sandbox-id>` |
| Resume last sandbox/mode | `ez-devbox resume` |
| Run command in sandbox | `ez-devbox command --sandbox-id <sandbox-id> -- pwd` |
| JSON output for automation | `ez-devbox list --json` |
| Wipe one sandbox | `ez-devbox wipe` |
| Wipe all sandboxes | `ez-devbox wipe-all --yes` |

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
  - make sure `.env` exists and contains `E2B_API_KEY`.
- `wipe-all requires --yes in non-interactive terminals`:
  - add `--yes` in CI/scripts.
- Multiple sandboxes in non-interactive runs:
  - pass `--sandbox-id <id>` explicitly.
- Tunnel command issues:
  - ensure `cloudflared` is installed, or Docker is available for fallback.

## launcher.config.toml reference

See `docs/launcher-config-reference.md`.
