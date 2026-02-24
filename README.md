# ez-devbox

Lightweight TypeScript CLI for running OpenCode/Codex agents with E2B sandboxes.

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
- Optionally syncs local tool auth/config (OpenCode, Codex, GitHub CLI) into sandbox during `create`
- Supports optional auto-managed local port tunneling for sandbox access of MCP servers, Docker containers, etc.

## Requirements

- Node.js 20+
- npm
- `E2B_API_KEY` set in `.env` or shell env
- `launcher.config.toml` available either locally (cwd) or globally (user config dir)
- Docker (and optionally `cloudflared`) installed if you want to use automatic port tunneling with the `[tunnel].ports` config

## Install

Recommended (local clone/workspace):

```bash
npm install
```

Optional global install:

```bash
npm install -g ez-devbox
```

Global install is a first-class flow. If no launcher config exists yet, `ez-devbox` can create one for you on first run.

Then run locally:

```bash
npm run dev -- --help
```

If you installed globally, you can also run:

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

4. Run commands:

```bash
npm run create
npm run connect
# optional, if globally installed:
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
- Create and skip interactive tooling-sync confirmation:
  - `ez-devbox create -- --yes-sync`
  - `npm run create -- --yes-sync`
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

- `launcher.config.toml`: ez-devbox behavior (sandbox, startup, project, env pass-through, tooling auth sync, tunnel). Resolved from local-first then global fallback.
- `.env`: secrets and local env values
- `.ez-devbox-last-run.json`: auto-generated local state for reconnects (legacy `.agent-box-last-run.json` is still read as a fallback)
- `docs/launcher-config-reference.md`: full `launcher.config.toml` field reference

## launcher.config.toml reference

See `docs/launcher-config-reference.md`.

## Dev checks

```bash
npm run test
npm run build
```
