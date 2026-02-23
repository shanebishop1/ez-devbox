# E2B Migration Research Report (from Daytona-based launcher)

## Purpose

This report captures research findings from E2B docs relevant to rebuilding the current Daytona-based box launcher from scratch on E2B.

Primary migration goals from `BOX_REQUIREMENTS.md`:

- Support startup options for:
  - OpenCode CLI
  - Codex CLI
  - OpenCode Web Server
  - Plain shell/SSH access
- Support single-repo and multi-repo clone workflows.
- Support per-repo setup scripts with retries/timeouts/env.
- Support creating new boxes and connecting to existing boxes.

---

## Sources Reviewed

- https://e2b.dev/docs/sandbox
- https://e2b.dev/docs/sandbox/connect
- https://e2b.dev/docs/sandbox/persistence
- https://e2b.dev/docs/sandbox/environment-variables
- https://e2b.dev/docs/sandbox/git-integration
- https://e2b.dev/docs/sandbox/ssh-access
- https://e2b.dev/docs/agents/opencode
- https://e2b.dev/docs/agents/codex
- https://e2b.dev/docs/sandbox-template
- https://e2b.dev/docs/template/start-ready-command
- https://e2b.dev/docs/sandbox-template/start-cmd
- https://e2b.dev/docs/sandbox-template/ready-cmd
- https://e2b.dev/docs/cli
- https://e2b.dev/docs/cli/create-sandbox

Notes:

- E2B docs currently show examples using both `e2b` and `@e2b/code-interpreter` package imports.
- Several capabilities are documented in SDK reference pages and feature guides rather than one single API page.

---

## Key Findings

## 1) Sandbox lifecycle (create, connect, list, kill)

E2B directly supports the core lifecycle operations needed for "create box" and "connect existing box":

- Create: `Sandbox.create(template?, options)`
- Connect existing: `Sandbox.connect(sandboxId, options?)`
- List running/paused: `Sandbox.list({ query: { state: [...] } })`
- Shutdown: `sandbox.kill()` or static kill by ID in some examples

Important behavior:

- Default sandbox timeout is short (typically 5 minutes) unless explicitly set.
- Timeout can be updated at runtime with `setTimeout`.
- Connect/resume behavior can reset timeout unless overridden.

Implication for migration:

- We can implement create vs connect cleanly as first-class CLI commands/modes.
- We must always set/refresh timeout intentionally to avoid accidental sandbox expiry.

---

## 2) Persistence and reconnect strategy

E2B supports persistence with pause/resume features (currently beta-labeled in docs):

- `betaPause()` to pause and preserve memory + filesystem
- Connect can resume paused boxes
- `betaCreate({ autoPause: true })` enables auto-pause model

Documented limits:

- Continuous runtime limits differ by tier (Base vs Pro)
- Network services inside sandbox are disconnected while paused; clients must reconnect after resume

Implication:

- For "reuse existing box" behavior, E2B can match (and in some ways improve) Daytona behavior.
- Web/server mode must handle reconnect after pause/resume.

---

## 3) OpenCode support is first-class

E2B has dedicated OpenCode docs and prebuilt template:

- Template: `opencode`
- CLI usage: `e2b sbx create opencode`
- Headless runs supported via `opencode run ...`
- Explicit examples for cloning repos then running OpenCode
- Explicit example for running OpenCode HTTP server and connecting externally via exposed host

Key pattern from docs:

- Start server in sandbox (`opencode serve --hostname 0.0.0.0 --port <port>`)
- Use `sandbox.getHost(<port>)`
- Access from outside via `https://<host>`

Implication:

- OpenCode web mode requirement is strongly aligned with official E2B patterns.
- We should use this as the default implementation pattern rather than legacy forwarding logic.

---

## 4) Codex support is first-class

E2B has dedicated Codex docs and prebuilt template:

- Template: `codex`
- CLI usage: `e2b sbx create codex`
- Headless examples include:
  - `codex exec --full-auto ...`
  - `--skip-git-repo-check` for sandbox contexts
  - JSON event streaming with `--json`

Implication:

- Codex startup mode can be implemented with native E2B guidance instead of custom bootstrapping hacks.

---

## 5) Git workflows are built into SDK

`sandbox.git` provides high-level operations:

- clone, checkout, create/delete branch
- status/branches
- add/commit/pull/push
- configure user identity
- credential helper (`dangerouslyAuthenticate`) and inline auth options

Security caveat from docs:

- credential helper stores credentials on disk in sandbox and is intentionally marked dangerous.

Implication:

- Single/all repo cloning and setup can be implemented directly through SDK.
- Use ephemeral inline credentials where possible; use persistent helper only when explicitly configured.

---

## 6) Env vars model supports launcher use case

E2B supports env vars in three scopes:

- Global at sandbox creation (`envs`)
- Per command execution
- Per code execution

Default metadata env vars exist in sandbox (`E2B_SANDBOX_ID`, template ID, etc.).

Implication:

- Existing pass-through env strategy maps well to E2B.
- We can keep allowlist-based pass-through design from the current config model.

---

## 7) SSH access is possible, but requires explicit template setup

E2B has an SSH access guide, but pattern is not "instant built-in SSH to every sandbox".

Documented approach:

- Build custom template with OpenSSH server + `websocat`
- Start WS->TCP proxy inside sandbox (e.g., port 8081)
- Connect using local SSH `ProxyCommand` + `websocat` via `wss://<port>-<sandbox-id>.e2b.app`

Implication:

- Plain shell mode can be implemented in two ways:
  1. SDK/PTY-based command shell wrapper (simpler)
  2. True SSH mode via custom template + websocat plumbing (more ops complexity, but closest parity)
- If strict SSH parity is required, design this early into template architecture.

---

## 8) Template customization is the right foundation

E2B supports custom templates via:

- `Template().fromTemplate(...)` or from base OS image
- install packages / copy files / set envs
- `setStartCmd(...)` and readiness checks (`waitForPort(...)` / ready cmd)
- build and publish alias via SDK or CLI

Implication:

- Best migration path is one custom template derived from `opencode` with Codex + any shell/ssh pieces added.
- This gives deterministic startup and avoids per-session installer drift.

---

## Capability Mapping vs Current Requirements

## Fully covered by E2B primitives

- Create new box
- Connect to existing box
- List running boxes
- Expose web services (OpenCode web server)
- Clone one or many repos
- Run setup scripts with streamed output
- Inject env vars
- Run OpenCode and Codex in sandbox

## Covered, but needs implementation choices

- Reuse/persistence strategy (connect-only vs auto-pause/resume)
- Long-running web reliability (timeout refresh vs pause model)
- Auth storage model for git operations

## Covered, but requires custom template and extra plumbing

- True SSH experience comparable to Daytona token SSH model

---

## Risks and Migration Considerations

1. **Doc/API variant drift**

- Docs show both `e2b` and `@e2b/code-interpreter` examples.
- Action: lock SDK version early and standardize imports in the new repo.

2. **SSH complexity**

- SSH is available but not trivial; requires websocat + template infra.
- Action: decide whether strict SSH parity is mandatory for v1.

3. **Persistence is beta-labeled in docs**

- Some pause/auto-pause APIs are beta-branded.
- Action: use connect/list as primary reuse path, optionally enable pause features behind config flag.

4. **Timeout handling can break UX if ignored**

- Sandbox expiration can terminate active sessions unexpectedly.
- Action: centralize timeout policy and periodic refresh where needed.

5. **Credential handling security**

- Git credential helper persistence is risky in shared/agent-heavy contexts.
- Action: default to least-persistence auth and explicit opt-in for persistent creds.

---

## Recommended Technical Direction (based on findings)

1. Build a new launcher repo from scratch on E2B SDK (no Daytona code migration).
2. Create one custom E2B template based on `opencode` and add:
   - Codex CLI
   - optional SSH stack (OpenSSH + websocat) if strict SSH is required
3. Implement startup modes as orchestrated actions over one sandbox abstraction:
   - `ssh-opencode`
   - `ssh-codex`
   - `web`
   - `ssh-shell`
4. Implement repo manager with single/all modes and setup runner (pre/setup/wrapper, retries, timeout, continue-on-error).
5. Implement explicit create/connect commands with list/select UX and local last-run state.
6. Add reliability guardrails: timeout refresh policy, structured errors, and integration tests around mode startup + repo setup.

---

## Bottom Line

E2B can satisfy the full target feature set, including OpenCode + Codex + web exposure + multi-repo orchestration + reconnect workflows. The only area that needs additional engineering design versus Daytona is strict SSH parity, which is still feasible with E2B’s documented SSH-over-WebSocket template pattern.
