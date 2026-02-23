# OpenCode Daytona Sandbox - Complete Requirements

## Overview

The "box" is a Daytona sandbox that runs the OpenCode coding agent with multiple access modes (SSH CLI, Web UI, plain SSH shell). It provides a secure, isolated environment for running AI-generated code.

---

## Core Features

### Access Modes
- **SSH + OpenCode CLI** - Interactive terminal with coding agent
- **SSH + Codex CLI** - Alternative CLI for code editing
- **OpenCode Web UI** - Browser-based interface (port 3000)
- **SSH Shell** - Plain terminal access (dashboard-style)

### Sandbox Capabilities
- Sub-90ms creation time
- Secure isolated runtime
- Unlimited persistence
- Filesystem operations via Daytona SDK
- Command execution with streaming output
- Git integration with auth
- Preview links for deployed apps
- Environment variable injection

---

## Required Configuration

### Files Required

**1. `launcher.config.toml`** - Non-secret behavior config
```toml
[opencode]
config_path = "~/.config/opencode/opencode.jsonc"  # Local OpenCode config
config_dir = "~/.config/opencode"                  # Local config directory
auth_path = "~/.local/share/opencode/auth.json"    # Local auth credentials

[sandbox]
reuse = true          # Reuse existing sandbox with same name
name = "opencode-web" # Sandbox name for reuse
delete_on_exit = false

[startup]
mode = "prompt"       # prompt | ssh-opencode | ssh-codex | web | ssh-shell

[project]
mode = "single"       # single | all (how many repos to clone)
active = "prompt"     # prompt | specific repo name | index
dir = "/home/daytona/projects/workspace"  # Base workspace dir
setup_on_connect = false    # Rerun setup on already-cloned repos
setup_retries = 2            # Retry count for setup failures
setup_continue_on_error = false

[gh]
config_dir = "~/.config/gh"  # Local GH CLI config
install = true               # Auto-install gh if missing

[codex]
config_dir = "~/.codex"      # Local Codex config
install = true               # Auto-install Codex CLI if missing

[env]
pass_through = ["MY_ENV"]    # Custom env keys to inject

[[project.repos]]
name = "example"
url = "https://github.com/user/repo.git"
branch = "main"
setup_command = "./scripts/setup.sh"
setup_env = { VAR = "value" }
startup_env = { ANOTHER_VAR = "value2" }
```

**2. `.env`** - Secrets and per-machine values
```env
# Required
DAYTONA_API_KEY=your_api_key_here

# Optional - Web mode password
OPENCODE_SERVER_PASSWORD=

# Optional - Preview URL configuration
PREVIEW_SIGNED_URL_TTL_SECONDS=3600
PREVIEW_URL_MODE=standard   # standard | signed | auto
WEB_LOCAL_PORT=39000

# Optional - GitHub auth (auto-reads from `gh auth token` if empty)
GITHUB_TOKEN=

# Optional - Git identity (auto-reads from git config if empty)
GIT_AUTHOR_NAME=
GIT_AUTHOR_EMAIL=

# Optional - Setup command tuning
SETUP_COMMAND_TIMEOUT_SECONDS=300
SETUP_RETRY_DELAY_SECONDS=8

# LLM Provider Keys (optional)
OPENAI_API_KEY=
ANTHROPIC_API_KEY=
OPENROUTER_API_KEY=
CEREBRAS_API_KEY=
CEREBRAS_PROXY_PORT=4310
GROQ_API_KEY=
GOOGLE_API_KEY=
GOOGLE_GENERATIVE_AI_API_KEY=
XAI_API_KEY=
DEEPSEEK_API_KEY=

# Custom env (must be in launcher.config.toml [env].pass_through)
MY_ENV=local-dev
```

### Node.js Requirements
- **Version:** 18+ required
- **Command:** `npm install` to install dependencies

---

## What Gets Installed/Synced Inside the Box

### Automatically Installed
1. **OpenCode CLI** - `npm i -g @anomalyco/opencode`
2. **GitHub CLI** - Installed to `/home/daytona/.local/bin/gh` (version 2.76.2)
3. **Codex CLI** - `npm i -g @openai/codex`

### Synced from Host Machine
1. **OpenCode Config** - `~/.config/opencode/` → `/home/daytona/.config/opencode/`
   - Excludes: `node_modules`, `.git`, `dist`, `build`, `.next`, `.turbo`, `.cache`
2. **OpenCode Auth** - `~/.local/share/opencode/auth.json` → `/home/daytona/.local/share/opencode/auth.json`
3. **GitHub CLI Config** - `~/.config/gh/` → `/home/daytona/.config/gh/`
   - Only synced if transferable oauth tokens present
4. **Codex Config** - `~/.codex/` → `/home/daytona/.codex/`
   - Syncs `auth.json` and `config.toml`

### Generated Files Inside Box
1. **Runtime Env Script** - `/home/daytona/.opencode-launcher-env.sh`
   - Exports all passed-through env vars (base64 encoded for safety)
2. **Generated OpenCode Config** - `/home/daytona/.config/opencode/opencode.daytona.generated.json`
   - Merges local config with Daytona-aware agent
3. **Cerebras Proxy Script** - `/home/daytona/.local/bin/cerebras-proxy.js`
   - Only if `CEREBRAS_API_KEY` is set
4. **On-Login Hook** - `/home/daytona/.daytona-on-login.sh`
   - Auto-starts services on SSH login
5. **Git Auth** - `/home/daytona/.netrc`
   - Configured with GitHub token from host

---

## Environment Variables Passed to Sandbox

### Built-in Pass-through Keys (Always Applied)
- `OPENAI_API_KEY`
- `ANTHROPIC_API_KEY`
- `GROQ_API_KEY`
- `OPENROUTER_API_KEY`
- `CEREBRAS_API_KEY`
- `GOOGLE_API_KEY`
- `GOOGLE_GENERATIVE_AI_API_KEY`
- `XAI_API_KEY`
- `DEEPSEEK_API_KEY`
- `GITHUB_TOKEN`
- `GH_TOKEN`
- `GIT_AUTHOR_NAME`
- `GIT_AUTHOR_EMAIL`
- `OPENCODE_SERVER_PASSWORD`
- `OPENCODE_SERVER_USERNAME`

### Custom Pass-through Keys
- Must be defined in `launcher.config.toml` → `[env].pass_through`
- Example: `pass_through = ["MY_ENV", "API_ENDPOINT"]`

---

## Project Repo Management

### Repo Selection Modes
- **`single`** - Clone only one repo (default)
  - Active repo specified by `project.active`
  - Can be `prompt` for interactive selection
- **`all`** - Clone all configured repos
  - All repos cloned to workspace
  - Switch between repos with `cd`

### Repo Configuration per TOML Entry
```toml
[[project.repos]]
name = "my-repo"                    # Friendly name
url = "https://github.com/user/repo.git"  # Git URL
branch = "main"                     # Optional branch (default: repo default)
setup_command = "./scripts/setup.sh"      # Optional post-clone command
setup_wrapper_command = "mise exec --"    # Optional prefix for command
setup_pre_command = "mise trust ./mise.toml"  # Optional pre-setup command
setup_env = { NODE_ENV = "development" }    # Env vars for setup only
startup_env = { PATH = "$HOME/.local/bin:$PATH" }  # Env for active repo
```

### Setup Command Behavior
- **Timeout:** Configurable via `SETUP_COMMAND_TIMEOUT_SECONDS` (default 300s)
- **Retries:** Configurable via `project.setup_retries` (default 2)
- **Retry Delay:** Configurable via `SETUP_RETRY_DELAY_SECONDS` (default 8s)
- **On Reconnect:** Controlled by `project.setup_on_connect` (default false)
- **Continue on Error:** Controlled by `project.setup_continue_on_error` (default false)
- **Live Streaming:** Setup output streamed to host terminal in real-time

---

## Git Authentication Setup

### GitHub Token Sources (Priority Order)
1. `.env` → `GITHUB_TOKEN` or `GH_TOKEN`
2. Host machine: `gh auth token` (auto-detected if CLI installed)
3. Fallback: Anonymous access

### Git Identity Sources
1. `.env` → `GIT_AUTHOR_NAME` and `GIT_AUTHOR_EMAIL`
2. Repository git config: `git config user.name` and `git config user.email`
3. Global git config: `git config --global user.name` and `git config --global user.email`
4. Fallback defaults: `opencode-launcher@daytona.io`

### Auth Implementation
- GitHub token stored in `/home/daytona/.netrc`
- Username defaults to `x-access-token` unless `GITHUB_USERNAME` is set
- Applied to both HTTP and HTTPS git operations

---

## Custom Agent Configuration

### Daytona-Aware System Prompt
- Automatically creates a "daytona" agent in OpenCode config
- Understands Daytona sandbox paths (`/home/daytona/projects/workspace/`)
- Knows about preview links for deployed apps
- Merged with any existing local OpenCode agent config

### Cerebras Proxy Integration (Optional)
- When `CEREBRAS_API_KEY` is set, creates local HTTP proxy
- Proxy runs on port `CEREBRAS_PROXY_PORT` (default 4310)
- OpenCode configured to use `http://127.0.0.1:4310/v1` as base URL
- Stabilizes Cerebras API calls from inside sandbox
- Proxy script: `/home/daytona/.local/bin/cerebras-proxy.js`

---

## SSH Configuration

### SSH Access
- **Host:** `ssh.app.daytona.io`
- **Auth:** Token-based (auto-generated by Daytona)
- **Duration:** 24-hour SSH tokens
- **Format:** `{token}@ssh.app.daytona.io`

### SSH Session Types
1. **SSH + OpenCode CLI** - Auto-launches `opencode` in selected repo
2. **SSH + Codex CLI** - Auto-launches `codex` in selected repo
3. **SSH Shell** - Pure shell access

### SSH Port Forwarding (Web Mode Fallback)
- If preview link unavailable, uses local SSH tunnel
- Maps remote port 3000 → local port `WEB_LOCAL_PORT` (default 39000)
- Attempts to find available port starting from 39000

---

## Preview Links

### Preview URL Modes
- **`standard`** - Stable Daytona sandbox preview URL
  - Format: `https://{port}-{sandbox-id}.proxy.daytona.works/`
- **`signed`** - Token-in-URL (browser-friendly, no prompts)
  - TTL configurable via `PREVIEW_SIGNED_URL_TTL_SECONDS` (default 3600s)
- **`auto`** - Use signed if available, otherwise standard

### Web UI Default Port
- **OpenCode Web:** Port 3000
- Auto-exposed via `sandbox.getPreviewLink(3000)`

---

## State Persistence

### Sandbox State
- **Name Persistence** - Reusable via `sandbox.name`
- **Filesystem** - Persists across reconnects (files, deps, logs)
- **Git State** - Repo clones and worktree state preserved
- **OpenCode Session Data** - Agent history stored in sandbox

### Last-Run State (Host)
- **File:** `.launcher-last-run.json`
- **Tracks:**
  - Last sandbox ID and name
  - Last active project
  - Last startup mode
  - Timestamp
- **Usage:** Prompted to reuse on subsequent runs (`y/n`)

### Session Sandbox Tracking
- Maintains map of project → sandbox for multi-project workflows
- Cleared when switching projects or contexts

---

## Commands

### `npm run create`
- Creates fresh sandbox (replaces existing with same name)
- Runs full setup: clone repos, install tools, sync configs
- Prompts for startup mode (unless configured)

### `npm run connect`
- Lists available sandboxes
- Prompts to select sandbox
- Starts configured startup mode
- **Flag:** `--no-select` skips picker, uses `sandbox.name`

### `npm run start`
- Alias for `npm run connect`

### Launcher Flags
- **`--no-reuse`** - Ignore last-run choices, always use wizard
- **`--no-select`** - Skip sandbox picker in connect mode

---

## Runtime Sequence

1. **Load Config** - Read `launcher.config.toml` and apply `.env` overrides
2. **Check Last Run** - Prompt to reuse previous sandbox/mode (if exists)
3. **Create/Reuse Sandbox** - Use existing if `sandbox.reuse=true` and exists
4. **Install/Verify Tools** - OpenCode, GH CLI, Codex (if enabled)
5. **Sync Configs** - OpenCode, GH, Codex configs from host
6. **Setup Git Auth** - Configure `.netrc` with token
7. **Clone/Reuse Repos** - Based on `project.mode` and `project.active`
8. **Run Setup Commands** - Per-repo `setup_command` with retry logic
9. **Inject Env** - Pass-through env vars to sandbox
10. **Generate OpenCode Config** - Merge local config with Daytona agent
11. **Start Services** - Cerebras proxy (if `CEREBRAS_API_KEY` set)
12. **Launch Mode** - SSH CLI, Web UI, or shell
13. **Save State** - Update `.launcher-last-run.json`

---

## Error Handling

### Setup Failures
- **Retries:** Respects `project.setup_retries` (default 2)
- **Delay:** Configurable via `SETUP_RETRY_DELAY_SECONDS` (default 8s)
- **Continue:** Controlled by `project.setup_continue_on_error`
- **Streaming:** Live output even during retries

### Session Creation Failures
- **Retries:** 5 attempts with 2-second delays
- **Fallback:** Falls back to non-streaming execution if session unavailable

### Repo Clone Conflicts
- **Detection:** Warns if target dir exists but not a git repo
- **Branch Switch:** Auto-checkout if repo reused and different branch

---

## Security

### Secrets Handling
- Secrets **never** written to `launcher.config.toml`
- All secrets in `.env` (gitignored per `.gitignore`)
- SSH tokens auto-generated per session (24-hour TTL)
- `.netrc` file permissions set to `600`

### Isolation
- Full process isolation in Daytona sandbox
- No access to host system
- Network access controlled via Daytona
- Preview link auth via token/signature

---

## Network Access

### Outbound (from Sandbox)
- Full internet access for:
  - npm/yarn/pnpm installs
  - git clone/push
  - LLM API calls
  - Any other CLI/network operations

### Inbound (to Sandbox)
- Via Daytona preview links (proxy)
  - Port 3000 exposed for OpenCode Web UI
  - Any other ports for deployed apps
- Via SSH tunnel (fallback)
  - Local port mapping via SSH `-L` flag

---

## Development Workflow

### Typical Flow
1. Developer `npm install` in project directory
2. Configure `launcher.config.toml` with repos and settings
3. Set `DAYTONA_API_KEY` in `.env`
4. Set any required LLM provider keys in `.env`
5. Run `npm run create` for first sandbox
6. Use `npm run connect` for subsequent sessions
7. Work in sandbox (SSH, Web, or shell)
8. Switch repos with `cd` in SSH mode
9. Commit/push code from within sandbox

### Multi-Repo Workflow
- Set `project.mode = "all"` to clone all repos
- Use `cd` to switch between projects
- Each repo can have its own `setup_command`
- Each repo can have its own `startup_env`

---

## Troubleshooting

### Common Issues

**Setup command hanging**
- Check `SETUP_COMMAND_TIMEOUT_SECONDS` - may need increase
- Use `project.setup_retries` > 1 for flaky operations
- Check network connectivity inside sandbox

**GitHub auth failing**
- Verify `GITHUB_TOKEN` is set or `gh auth token` works locally
- Check `.netrc` inside sandbox: `cat /home/daytona/.netrc`
- Test git operation: `git -C /home/daytona/projects/workspace/my-repo fetch`

**Preview link not accessible**
- Try changing `PREVIEW_URL_MODE` to `signed`
- Check that service is running on port 3000: `curl http://localhost:3000`
- Try SSH fallback tunnel (auto-attempts when preview fails)

**LLM API errors**
- Verify provider key is set correctly
- Check if proxy is needed (Cerebras, etc.)
- Test API call from sandbox: `curl -H "Authorization: Bearer $KEY" https://api...`

**Config not syncing**
- Check local paths in `launcher.config.toml`
- Verify local config files exist on host
- Check for permission issues

---

## Performance Considerations

### Startup Time Optimization
- **Sandbox Reuse:** Set `reuse = true` to avoid recreation
- **Setup On Connect:** Set `setup_on_connect = false` to skip on reconnect
- **Config Sync:** Heavy config dirs (large `node_modules`) excluded automatically

### Network Optimization
- **Setup Retries:** Adjust for flaky networks
- **Timeout Tuning:** Increase `SETUP_COMMAND_TIMEOUT_SECONDS` for slow installs
- **Fetch Limit:** Git fetches run with timeout, retry on failure

### Resource Limits
- No explicit resource limits imposed by launcher
- Defaults to Daytona sandbox defaults
- Can be customized via Daytona dashboard/org settings

---

## Extensibility

### Adding Custom Env
1. Add to `.env`: `MY_CUSTOM_VAR=value`
2. Add to `launcher.config.toml`:
   ```toml
   [env]
   pass_through = ["MY_CUSTOM_VAR"]
   ```

### Adding Custom Setup Steps
1. Add to repo config:
   ```toml
   [[project.repos]]
   setup_pre_command = "mise install"       # Before main setup
   setup_command = "npm run bootstrap"      # Main setup
   setup_wrapper_command = "mise exec --"   # Wraps main setup
   ```

### Custom Agent Prompts
1. Modify local `~/.config/opencode/opencode.jsonc`
2. Launcher merges with Daytona-aware agent automatically

### Adding New Startup Modes
- Requires TypeScript code changes in `src/index.ts`
- Modify ` StartupMode` type and `selectStartupMode()` function
- Add mode implementation in launch section

---

## Version Requirements

### Core Dependencies (from package.json)
- **@daytonaio/sdk:** ^0.144.0
- **dotenv:** ^16.3.1
- **jsonc-parser:** ^3.3.1
- **smol-toml:** ^1.6.0

### Dev Dependencies
- **@types/node:** ^20.8.0
- **typescript:** ^5.2.2

### Runtime Requirements
- **Node.js:** 18+
- **npm:** (any version with Node.js 18+)
- **git:** Required on host for identity reading
- **gh CLI:** Optional on host (for token auto-read)