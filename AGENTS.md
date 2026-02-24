# AGENTS.md

Guidance for coding agents working in this repository (`ez-box`, a TypeScript CLI for E2B sandboxes).

## Purpose

- Keep changes small, typed, and test-backed.
- Preserve existing CLI behavior unless a task explicitly asks for behavior changes.
- Follow current repository conventions before introducing new patterns or tools.

## Repository Snapshot

- Runtime: Node.js `>=20`.
- Language: TypeScript (`NodeNext`, strict mode).
- Test runner: Vitest (`test/**/*.test.ts`, Node environment).
- Build toolchain: `tsgo` with `tsconfig.build.json`.
- Main source: `src/`.
- Tests: `test/`.
- CLI entrypoint: `src/cli/index.ts`.

## Install and Environment

```bash
npm install
```

- `.env` is used for local runtime config.
- `E2B_API_KEY` is required for real CLI operations against E2B.
- Unit tests mostly mock dependencies; many tests run without live credentials.

## Build, Lint, and Test Commands

```bash
# Build (and compile-time type validation)
npm run build

# Remove build artifacts
npm run clean

# Run all unit tests once
npm run test
```

## Running a Single Test (Important)

```bash
# Single file
npm run test -- test/config.load.test.ts

# Single test case in a file
npm run test -- test/config.load.test.ts -t "rejects missing E2B_API_KEY"

# Pattern across the suite
npm run test -- -t "connect uses --sandbox-id"
```

- For watch mode, invoke Vitest directly:

```bash
npx vitest test/config.load.test.ts
```

## Linting Status

- There is no dedicated lint script/config (`eslint`, `biome`, `prettier`) in this repo today.
- Do not assume `npm run lint` exists.
- Validation baseline for changes is `npm run test` and `npm run build`.

## Code Style Guidelines

Conventions below are inferred from the existing codebase and should be treated as defaults.

## Imports and Modules

- Use ESM imports.
- Use explicit `.js` extensions for relative imports from `.ts` files.
- Prefer import grouping order: Node built-ins, external packages, internal modules.
- Use `import type` for type-only imports.
- Prefer named exports for runtime modules.

## Formatting and Structure

- Use 2-space indentation.
- Use semicolons.
- Use double-quoted strings.
- Match surrounding trailing-comma style in the file you edit.
- Keep functions focused; extract helpers for complex branches.
- Add comments only when a non-obvious block needs intent explained.

## Types and API Shapes

- Keep strict types; avoid `any`.
- Represent domain contracts with explicit interfaces/types.
- Use string unions for bounded value sets (modes, commands, states).
- Preserve dependency-injection patterns used for testability (`*Deps` + `defaultDeps`).
- Narrow unknown errors before reading message/code.

## Naming Conventions

- `PascalCase`: interfaces/types.
- `camelCase`: variables/functions.
- `UPPER_SNAKE_CASE`: module constants.
- File names: kebab-case with dotted grouping where already established (for example `commands.create.ts`).
- Test names should describe behavior/results, not implementation details.

## Error Handling and Logging

- Throw explicit errors with actionable context.
- Include operation and target path/id when propagating failures.
- Convert unknown thrown values into readable messages.
- Use shared logger utilities for user-visible CLI output (`src/logging/logger.ts`).
- Avoid silent catches except for explicitly optional flows (for example optional `.env` loading).

## CLI and Command Patterns

- Parse arguments with explicit validation and clear failure messages.
- Return `CommandResult` from command handlers.
- Keep side-effectful orchestration in command modules, with reusable helpers below them.
- Maintain TTY-aware behavior for prompt vs non-interactive fallback paths.

## Testing Expectations

- Use Vitest APIs (`describe`, `it`, `expect`, `vi`).
- Prefer dependency injection and mocks over real network/sandbox calls in unit tests.
- Cover both success and failure paths for config parsing, command routing, and lifecycle flows.
- Add regression tests for bug fixes whenever practical.

## Security and Secrets

- Never commit secrets from `.env`, auth files, or local machine config.
- Be careful when modifying token/env propagation (`GH_TOKEN`, `GITHUB_TOKEN`, provider API keys).
- Keep host-to-sandbox credential sync explicit and minimal.

## Cursor and Copilot Rules

- Checked for `.cursor/rules/`, `.cursorrules`, and `.github/copilot-instructions.md`.
- No Cursor/Copilot instruction files exist in this repository at this time.
- If these files are added later, treat them as authoritative supplements to this document.

## Change Checklist for Agents

- Run targeted tests for changed areas (single file or `-t` pattern).
- Run `npm run test` for broader changes.
- Run `npm run build` before finalizing non-trivial edits.
- Keep style/import/type patterns aligned with nearby files.
- Update docs when commands or developer workflows change.
