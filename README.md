# 🤖 ez-devbox 📦

`ez-devbox` runs coding agents in disposable [E2B](https://e2b.dev) sandboxes. It clones your repos, syncs selected tool config and credentials, and lets you reconnect to persistent sessions.

## Features

- Launch and reconnect to OpenCode, Codex, Claude Code, or a shell in the same sandbox.
- Clone repos, check out branches, and run setup commands from a TOML config.
- Forward selected environment variables and sync local tool auth/config.
- Reach local MCP servers, Docker containers, or other services through optional tunnels.

## Agent Modes

- `ssh-opencode`: SSH into the sandbox and attach the OpenCode TUI to a persistent in-sandbox `opencode serve` backend.
- `ssh-codex`: SSH into the sandbox and attach Codex inside a persistent `tmux` session.
- `ssh-claude`: SSH into the sandbox and attach Claude Code inside a persistent `tmux` session.
- `web`: start `opencode serve` and print the URL.
- `ssh-shell`: SSH into an interactive shell inside a persistent `tmux` session.

## Install

Prereqs: Node.js 20+, `E2B_API_KEY`, and a `ez-devbox.config.toml` (local or global). Docker/`cloudflared` only if you use tunnel features.

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
# Short alias after global install:
ezdb --help
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

2. Create/edit `ez-devbox.config.toml`.

Config lookup order:

- Local: `./ez-devbox.config.toml` (from the directory where you run `ez-devbox`)
- Global: user config file
  - macOS/Linux: `~/.config/ez-devbox/ez-devbox.config.toml`
  - Windows: `%APPDATA%\\ez-devbox\\ez-devbox.config.toml`

If neither file exists and you're in an interactive terminal, ez-devbox prompts you to create a starter config locally or globally, then continues with it. In non-interactive environments, it exits with an error listing both expected paths.

If you do not already have one, create a starter config:

```bash
cat > ez-devbox.config.toml <<'EOF'
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

Use `npx ez-devbox ...` if the CLI is not globally installed. After global install, `ezdb` is also available as a short alias for `ez-devbox`.

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

Use `--json` for machine-readable output:

- `list`: `{ "sandboxes": [...] }`
- `command`: command result envelope (`sandboxId`, `command`, `cwd`, `stdout`, `stderr`, `exitCode`)
- `create` / `connect`: launch result envelope (mode, command/url when present, workingDirectory, setup summary)

Optional fields are omitted when undefined (for example `url` is absent for SSH modes).

## Verbose mode

- Use `--verbose` to show detailed operational logs during `create/connect` (startup mode resolution, sandbox lifecycle steps, create-time tooling sync progress, bootstrap progress, SSH/tunnel setup details).
- Interactive pickers/prompts still show as normal.
- Without `--verbose`, ez-devbox keeps output focused on prompts and final command results.

## Config files

- `ez-devbox.config.toml`: ez-devbox behavior (sandbox, startup, project, env pass-through, tooling auth sync, tunnel). Resolved from local-first then global fallback.
- `.env`: secrets and local env values
- last-run state: by default stored at `${TMPDIR}/ez-devbox/last-run/cwd-state/<sha1(cwd)>/.ez-devbox-last-run.json` (legacy `.agent-box-last-run.json` in the current directory is still read only for persisted-data compatibility)
- `docs/launcher-config-reference.md`: full `ez-devbox.config.toml` field reference

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

## ez-devbox.config.toml reference

See `docs/launcher-config-reference.md`.
