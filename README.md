# Agent Box (E2B Launcher)

Lightweight TypeScript CLI for creating and reconnecting E2B sandboxes for coding workflows.

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

## Quick start

1. Install deps:

```bash
npm install
```

2. Create `.env` (or copy from `.env.example`) and set at least:

```env
E2B_API_KEY=your_key_here
```

3. Review `launcher.config.toml` (startup mode, repo mode, MCP settings).

4. Run commands:

```bash
npm run create
npm run connect
npm run start
```

## Common commands

- Show CLI help:
  - `npm run dev -- --help`
- Create with explicit mode:
  - `npm run create -- --mode web`
- Connect to specific sandbox:
  - `npm run connect -- --sandbox-id <sandbox-id>`
- Start without last-run reuse:
  - `npm run start -- --no-reuse`

## Config files

- `launcher.config.toml`: launcher behavior (sandbox, startup, project, env pass-through, mcp)
- `.env`: secrets and local env values
- `.agent-box-last-run.json`: auto-generated local state for reconnects

## Dev checks

```bash
npm run test
npm run build
```
