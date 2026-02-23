# Agent Box E2B Launcher

Module 0 bootstrap for an E2B-first TypeScript launcher.

## Architecture (bootstrap)

- `src/cli`: entrypoint and command routing (`create`, `connect`, `start`)
- `src/config`: config schema, defaults, and load stub
- `src/e2b`: lifecycle/client timeout boundaries for SDK integration
- `src/modes`: startup mode placeholders (`opencode`, `codex`, `web`, `shell`)
- `src/repo`: repository provisioning boundaries
- `src/setup`: setup command pipeline boundary
- `src/auth`: token and git identity boundaries
- `src/mcp`: Firecrawl preflight boundary
- `src/state`: last-run state boundary
- `src/logging`: logger utility
- `src/types`: shared bootstrap types

## Scripts

- `npm run dev -- --help`
- `npm run test`
- `npm run build`
