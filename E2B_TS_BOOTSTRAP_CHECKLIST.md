# E2B TypeScript SDK Bootstrap Checklist

This checklist turns the modular plan into a concrete, file-by-file implementation starting point.

## Stack lock

- Language: TypeScript (Node 20+ recommended)
- SDK: `e2b` (TypeScript SDK)
- CLI runtime: Node + npm

---

## 1) Repository skeleton

Create this structure in the new repo:

```text
.
├── package.json
├── tsconfig.json
├── launcher.config.toml
├── .env.example
├── README.md
├── templates/
│   ├── template.ts
│   └── build.ts
├── src/
│   ├── cli/
│   │   ├── index.ts
│   │   ├── commands.create.ts
│   │   ├── commands.connect.ts
│   │   └── commands.start.ts
│   ├── config/
│   │   ├── schema.ts
│   │   ├── load.ts
│   │   └── defaults.ts
│   ├── e2b/
│   │   ├── client.ts
│   │   ├── lifecycle.ts
│   │   └── timeout.ts
│   ├── modes/
│   │   ├── index.ts
│   │   ├── opencode.ts
│   │   ├── codex.ts
│   │   ├── web.ts
│   │   └── shell.ts
│   ├── repo/
│   │   ├── manager.ts
│   │   └── selection.ts
│   ├── setup/
│   │   ├── runner.ts
│   │   └── retry.ts
│   ├── auth/
│   │   ├── token.ts
│   │   └── gitIdentity.ts
│   ├── mcp/
│   │   └── firecrawl.ts
│   ├── state/
│   │   └── lastRun.ts
│   ├── logging/
│   │   └── logger.ts
│   └── types/
│       └── index.ts
└── test/
    ├── integration.create-connect.test.ts
    ├── integration.modes.test.ts
    ├── integration.repo-setup.test.ts
    └── integration.mcp-preflight.test.ts
```

---

## 2) Package and scripts

Minimum scripts:

- `build`: `tsc -p tsconfig.json`
- `dev`: run CLI via `tsx src/cli/index.ts`
- `create`: `tsx src/cli/index.ts create`
- `connect`: `tsx src/cli/index.ts connect`
- `start`: `tsx src/cli/index.ts start`
- `template:build`: `tsx templates/build.ts`
- `test`: integration + unit tests

Suggested deps:

- runtime: `e2b`, `dotenv`, `smol-toml`
- dev: `typescript`, `tsx`, `@types/node`, test runner (`vitest` or `jest`)

---

## 3) Config contract (`launcher.config.toml`)

Define and enforce:

- `[sandbox]`
  - `template`
  - `reuse`
  - `name`
  - `timeout_ms`
  - `delete_on_exit`
- `[startup]`
  - `mode = prompt|ssh-opencode|ssh-codex|web|ssh-shell`
- `[project]`
  - `mode = single|all`
  - `active = prompt|name|index`
  - `dir`
  - `setup_on_connect`
  - `setup_retries`
  - `setup_continue_on_error`
- `[[project.repos]]`
  - `name`, `url`, `branch`
  - `setup_pre_command`
  - `setup_command`
  - `setup_wrapper_command`
  - `setup_env`
  - `startup_env`
- `[env]`
  - `pass_through = []`
- `[mcp]`
  - `mode = disabled|remote_url|in_sandbox`
  - `firecrawl_api_url`
  - `allow_localhost_override`

---

## 4) E2B client abstraction (TypeScript SDK)

`src/e2b/lifecycle.ts` should expose a stable internal interface:

```ts
export interface SandboxHandle {
  sandboxId: string
  run(command: string, opts?: { cwd?: string; envs?: Record<string, string> }): Promise<{ stdout: string; stderr: string; exitCode: number }>
  getHost(port: number): Promise<string> | string
  setTimeout(timeoutMs: number): Promise<void>
  kill(): Promise<void>
}

export async function createSandbox(/* resolved config */): Promise<SandboxHandle>
export async function connectSandbox(sandboxId: string, /* resolved config */): Promise<SandboxHandle>
export async function listSandboxes(/* filters */): Promise<Array<{ sandboxId: string; state?: string; metadata?: Record<string, string> }>>
```

Implementation notes:

- Pin one SDK surface (`e2b`) and avoid mixed imports from older package names.
- Wrap SDK errors into launcher-specific error types.

---

## 5) Startup modes implementation order

1. `web` (OpenCode server + `getHost(3000)`)
2. `ssh-opencode` (OpenCode CLI mode)
3. `ssh-codex` (Codex CLI mode)
4. `ssh-shell` (plain shell)
5. `prompt` router

`src/modes/web.ts` acceptance behavior:

- Start `opencode serve --hostname 0.0.0.0 --port 3000`
- Wait for health endpoint
- Print HTTPS URL from sandbox host resolver

---

## 6) Repo + setup workflow

`src/repo/manager.ts`:

- Implement `single|all` clone selection
- Reuse existing clone path when valid git repo exists
- Branch checkout if configured branch differs

`src/setup/runner.ts`:

- Execute pre/setup/wrapper pipeline in order
- Per-repo timeout + retries + delay
- Stream output live to user

---

## 7) Auth, env, identity

`src/auth/token.ts`:

- Resolve token priority (`GITHUB_TOKEN` -> `GH_TOKEN` -> optional host CLI lookup)

`src/auth/gitIdentity.ts`:

- Configure git identity in sandbox from env or defaults

`src/config/load.ts`:

- Build final env pass-through map from allowlist

---

## 8) MCP Firecrawl support for remote E2B

`src/mcp/firecrawl.ts` should enforce:

- In E2B mode, reject `http://localhost:*` unless `allow_localhost_override=true`
- Require `FIRECRAWL_API_URL` for `remote_url` mode
- Inject `FIRECRAWL_API_URL` and `FIRECRAWL_API_KEY` into sandbox envs

Important:

- Your current wrapper uses local Docker and `localhost:3002`; this is host-only.
- For E2B, pass a reachable remote URL or tunnel URL.

---

## 9) Local state + UX

`src/state/lastRun.ts`:

- Persist last sandbox ID, mode, active project, timestamp
- Used by `start/connect` to offer fast reuse

CLI behavior:

- `create`: always creates new sandbox unless config says reuse by selector
- `connect`: lists/selects existing sandbox
- `start`: alias to connect behavior with smart reuse

---

## 10) Template scripts

`templates/template.ts`:

- Base from `opencode`
- Install Codex CLI and any shell helpers
- Optional SSH stack behind feature flag

`templates/build.ts`:

- Build and publish alias (e.g., `my-opencode-codex`)
- Log template ID/alias for config updates

---

## 11) Test matrix (minimum)

- create sandbox -> run command -> kill
- connect existing sandbox -> verify same filesystem marker
- web mode returns reachable host URL
- single repo clone path works
- all repos clone path works
- setup retry logic obeys limits
- MCP preflight fails on localhost URL in E2B mode

---

## 12) Milestones

## Milestone 1 (3-4 days)

- Modules: config, lifecycle, web mode, opencode/codex modes, basic repo clone

## Milestone 2 (2-3 days)

- Setup runner, auth/identity, last-run state, better errors

## Milestone 3 (2-4 days)

- MCP preflight/env integration, test hardening, docs polish

## Milestone 4 (optional)

- SSH parity mode with OpenSSH + websocat template path

---

## Definition of done

- New repo uses TypeScript + `e2b` SDK only (no Daytona code).
- All required startup modes are implemented and tested.
- Single/all repo setup works with retries/timeouts/env.
- Create/connect flows are stable with persisted local state.
- MCP story is explicit and safe for remote sandboxes.
