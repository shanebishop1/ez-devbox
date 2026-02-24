# ez-box

Lightweight TypeScript CLI for creating, reconnecting, and launching E2B coding sandboxes.

## What it does

- Creates or connects to an E2B sandbox
- Launches one startup mode:
  - `ssh-opencode`
  - `ssh-codex`
  - `web` (starts `opencode serve` and returns URL)
  - `ssh-shell`
  - `prompt` (deterministic fallback to `ssh-opencode` for now)
- Persists last-run state locally so reconnects are fast
- Validates config and MCP/Firecrawl settings before launch

## Requirements

- Node.js 20+
- npm
- `E2B_API_KEY` set in `.env` or shell env

## Install

```bash
npm install -g ez-box
```

Then run:

```bash
ez-box --help
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

3. Review `launcher.config.toml` (sandbox, startup mode, repo mode, MCP settings).

4. Run commands:

```bash
npm run create
npm run connect
npm run start
# or, once installed from npm:
ez-box create
ez-box connect
ez-box start
```

## Common commands

- Show CLI help:
  - `ez-box --help`
  - `npm run dev -- --help`
- Create with explicit mode:
  - `ez-box create -- --mode web`
  - `npm run create -- --mode web`
- Connect to specific sandbox:
  - `ez-box connect -- --sandbox-id <sandbox-id>`
  - `npm run connect -- --sandbox-id <sandbox-id>`
- Start without last-run reuse:
  - `ez-box start -- --no-reuse`
  - `npm run start -- --no-reuse`

## Config files

- `launcher.config.toml`: ez-box behavior (sandbox, startup, project, env pass-through, mcp)
- `.env`: secrets and local env values
- `.ez-box-last-run.json`: auto-generated local state for reconnects (legacy `.agent-box-last-run.json` is still read as a fallback)

## Dev checks

```bash
npm run test
npm run build
```
