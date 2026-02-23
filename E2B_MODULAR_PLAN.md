# E2B From-Scratch Build Plan (Modular)

## Scope

Build a new repository (no Daytona code reuse) that launches and manages E2B sandboxes with startup modes for:

- Implementation language: **TypeScript**
- Runtime SDK: **E2B TypeScript SDK (`e2b`)**

- OpenCode CLI
- Codex CLI
- OpenCode Web Server exposure
- Shell/SSH access

And supports:

- Create new box or connect to existing box
- Single-repo or multi-repo clone workflows
- Per-repo setup script execution with retries/timeouts/env

---

## Constraints and Decisions

## Confirmed from research

- E2B natively supports create/connect/list/kill sandbox lifecycle.
- E2B supports exposed service URLs via `getHost(port)`.
- E2B has prebuilt templates for `opencode` and `codex`.
- SSH is possible but requires explicit custom template plumbing (`openssh-server` + `websocat`).

## Confirmed from local dotfiles review

- Current OpenCode config defines Firecrawl MCP as a local process (`type: "local"`) using `node ~/.dotfiles/mcp/firecrawl-wrapper.js`.
- That MCP wrapper defaults to `FIRECRAWL_API_URL=http://localhost:3002` and bootstraps Firecrawl through local Docker Compose.

Operational implication for E2B:

- A remote E2B sandbox cannot directly reach your laptop `localhost:3002`.
- To use Firecrawl from inside E2B, we must either:
  1. run Firecrawl in the sandbox or in a reachable remote environment, or
  2. expose host Firecrawl through a secure public/tunneled URL and point sandbox env there.

Recommended default:

- Treat Firecrawl as an external remote service for sandbox workloads and pass `FIRECRAWL_API_URL` as an env var when creating/connecting the sandbox.

---

## Target Architecture

## High-level components

1. `cli` - command entrypoints (`create`, `connect`, `start`).
2. `config` - parse/validate TOML + `.env` + defaults.
3. `sandbox` - E2B lifecycle adapter (create, connect, list, kill, timeout).
4. `template` - template build/publish scripts and metadata.
5. `modes` - startup mode implementations (`opencode`, `codex`, `web`, `shell`, optional `ssh`).
6. `repo` - clone/select/switch for single/all modes.
7. `setup` - per-repo setup command runner with retry policy.
8. `auth` - git token + identity setup and env pass-through policy.
9. `state` - local last-run persistence and sandbox selection hints.
10. `telemetry/logging` - user-facing structured logs and failure diagnostics.

---

## Modular Execution Plan

## Module 0 - New repo bootstrap

Goal:

- Start with a clean codebase and strict boundaries.

Tasks:

- Initialize TypeScript project and scripts.
- Add source layout:
  - `src/cli`
  - `src/config`
  - `src/e2b`
  - `src/modes`
  - `src/repo`
  - `src/setup`
  - `src/auth`
  - `src/state`
- Add baseline lint/test/build tooling.

Deliverables:

- Runnable `npm run dev` and `npm run build`.
- Clean architecture README section.

Acceptance criteria:

- No Daytona dependency remains.
- CI runs lint + typecheck + tests.

## Module 1 - Config system and schema

Goal:

- Replace Daytona-oriented config with E2B-first config while keeping familiar knobs.

Tasks:

- Define `launcher.config.toml` schema:
  - `sandbox` (template, timeout, reuse/connect preferences)
  - `startup` (mode or prompt)
  - `project` (single/all/active/workspace)
  - `repos[]` (url, branch, setup commands/env)
  - `env.pass_through[]`
  - `features` (ssh_enabled, persistence_mode, mcp mode)
- Load `.env` and validate required keys.
- Produce resolved runtime config object.

Deliverables:

- Config parser/validator module.
- `.env.example` and config docs.

Acceptance criteria:

- Invalid config fails with actionable errors.
- All current required knobs map to E2B behavior.

## Module 2 - E2B lifecycle adapter

Goal:

- Encapsulate all E2B SDK interactions behind one API.

Tasks:

- Implement adapter methods:
  - `createSandbox()`
  - `connectSandbox()`
  - `listSandboxes()`
  - `killSandbox()`
  - `refreshTimeout()`
- Add metadata tagging for sandbox lookup (project, mode, user).
- Support create vs connect flows with explicit UX.

Deliverables:

- `src/e2b/client.ts` + adapter tests.

Acceptance criteria:

- Can create, list, connect, and run a test command in sandbox.
- Timeout policy is applied consistently.

## Module 3 - Template strategy

Goal:

- Ensure predictable sandbox startup with needed tools pre-installed.

Tasks:

- Build one custom template based on `opencode`:
  - install Codex CLI
  - optional `gh` tooling
  - optional SSH stack (OpenSSH + websocat)
- Add `templates/build.ts` and `templates/template.ts`.
- Publish template alias and lock in config.

Deliverables:

- Versioned template build scripts.

Acceptance criteria:

- New sandbox from template has working `opencode` and `codex` binaries.

## Module 4 - Startup mode orchestrator

Goal:

- Provide user-selectable startup modes with shared runtime setup.

Tasks:

- Implement modes:
  - `ssh-opencode`: run OpenCode CLI
  - `ssh-codex`: run Codex CLI
  - `web`: start OpenCode server and expose URL
  - `ssh-shell`: plain shell mode (PTY or SSH-backed)
  - `prompt`: interactive selection
- Standardize environment and working directory setup per mode.

Deliverables:

- `src/modes/*` modules and mode registry.

Acceptance criteria:

- All configured modes launch successfully from one command path.

## Module 5 - Repo orchestration (single/all)

Goal:

- Provide deterministic repo provisioning per sandbox session.

Tasks:

- Implement repo selection logic for `single|all` and `active` semantics.
- Clone via `sandbox.git.clone` with branch handling.
- Detect/reuse existing clone and reconcile branch changes.

Deliverables:

- `src/repo/manager.ts` with tests.

Acceptance criteria:

- Single repo and all repo modes both pass integration tests.

## Module 6 - Setup runner

Goal:

- Run project setup commands robustly and visibly.

Tasks:

- Implement ordered execution:
  - `setup_pre_command`
  - wrapped `setup_command` (optional wrapper)
- Add retries, timeout, delay, continue-on-error behavior.
- Stream stdout/stderr to local user terminal.

Deliverables:

- `src/setup/runner.ts` with retry policy tests.

Acceptance criteria:

- Setup behavior matches config for success and failure paths.

## Module 7 - Auth and identity

Goal:

- Configure git and runtime credentials safely.

Tasks:

- Implement token resolution priority (`.env`, optional host detection).
- Configure git identity (global/local) in sandbox.
- Provide credential strategy:
  - default: inline/ephemeral
  - optional: persistent helper with explicit opt-in

Deliverables:

- `src/auth/*` modules and docs.

Acceptance criteria:

- Private repo clone and push/pull succeed in integration tests.

## Module 8 - MCP/Firecrawl strategy for E2B

Goal:

- Make MCP behavior explicit for remote sandboxes.

Tasks:

- Add MCP modes to config:
  - `disabled`
  - `remote_url` (recommended)
  - `in_sandbox` (advanced, if feasible)
- For `remote_url`, inject:
  - `FIRECRAWL_API_URL`
  - `FIRECRAWL_API_KEY`
- Add preflight validation:
  - reject `localhost` URL when running in E2B unless explicitly overridden
  - show actionable warning with fix instructions

Deliverables:

- `src/mcp/firecrawl.ts` preflight and env wiring.

Acceptance criteria:

- Sandbox mode fails fast with clear error if MCP URL is unreachable or local-only.

## Module 9 - Web server exposure

Goal:

- Expose OpenCode web server reliably.

Tasks:

- Start `opencode serve --hostname 0.0.0.0 --port 3000` in background.
- Poll health endpoint until ready.
- Resolve external URL with `sandbox.getHost(3000)`.
- Add reconnect handling (server restart if needed after reconnect/resume).

Deliverables:

- `src/modes/web.ts` + health checks.

Acceptance criteria:

- User receives working HTTPS URL and can open OpenCode web UI.

## Module 10 - State and UX

Goal:

- Keep reconnect flow fast without hidden magic.

Tasks:

- Persist local last-run state (`sandboxId`, startup mode, active repo, timestamp).
- Implement `--no-reuse` and `--no-select` behavior.
- Add prompt-driven fallback UX where config says `prompt`.

Deliverables:

- `src/state/store.ts` and CLI prompt flows.

Acceptance criteria:

- Repeated sessions can reconnect with minimal prompts.

## Module 11 - Validation and hardening

Goal:

- Prove reliability across expected workflows.

Tasks:

- Integration tests for:
  - create/connect
  - each startup mode
  - single/all repo modes
  - setup retries/timeouts
  - web host exposure
  - MCP preflight behavior
- Add structured error taxonomy and troubleshooting docs.

Deliverables:

- Test suite + troubleshooting guide.

Acceptance criteria:

- End-to-end happy paths and core failure paths are covered.

---

## Delivery Phases

## Phase A (MVP)

- Modules 0-2, 4 (opencode/codex/web), 5, 6, 10
- No strict SSH parity yet
- MCP in `remote_url` mode only

## Phase B (parity)

- Module 3 hardening
- Module 7 auth refinements
- Module 9 reliability polish
- Optional shell improvements

## Phase C (advanced)

- SSH parity via custom SSH template path
- Persistence/auto-pause policy tuning
- Optional in-sandbox MCP path

---

## Answer to "Can E2B use host Docker Firecrawl on localhost:3002?"

Short answer: not directly.

- Your current setup is host-local (`localhost:3002`), and E2B sandbox is a remote VM.
- `localhost` inside sandbox points to the sandbox itself, not your machine.

Working options:

1. **Recommended**: run Firecrawl as remote reachable service and pass that URL into sandbox env.
2. Expose host Firecrawl via secure tunnel (for dev use), then pass tunnel URL into sandbox env.
3. Run Firecrawl inside E2B environment (advanced, depends on runtime constraints and operational cost).
