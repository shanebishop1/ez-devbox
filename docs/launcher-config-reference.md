# ez-devbox.config.toml reference

ez-devbox resolves config in this order:

1. Local `./ez-devbox.config.toml` (current working directory)
2. Global user config `ez-devbox.config.toml`
   - macOS/Linux: `~/.config/ez-devbox/ez-devbox.config.toml`
   - Windows: `%APPDATA%\\ez-devbox\\ez-devbox.config.toml`

If neither file exists and a TTY is available, ez-devbox prompts to create a starter config locally or globally.

The package includes a complete example at `examples/minimal/ez-devbox.config.toml`. From an arbitrary directory, you can also download it from:

```text
https://raw.githubusercontent.com/shanebishop1/ez-devbox/main/examples/minimal/ez-devbox.config.toml
```

## Last-run state location

Last-run state is runtime metadata (not a launcher config field). By default it is stored at:

- `${TMPDIR}/ez-devbox/last-run/cwd-state/<sha1(cwd)>/.ez-devbox-last-run.json`

Compatibility behavior:

- If the new default file is missing, ez-devbox still reads legacy `.agent-box-last-run.json` when present (legacy compatibility only).

## Starter config

Copy/paste this starter file into `ez-devbox.config.toml` if you are setting up a new workspace:

```toml
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
```

## `[sandbox]`

- `template` (string): E2B template slug used when creating new sandboxes.
- `reuse` (boolean): currently reserved for reuse policy and not used to change runtime behavior.
- `name` (string): base display name prefix used in launcher metadata.
- `timeout_ms` (number): sandbox timeout in milliseconds; must be a positive integer.
- `delete_on_exit` (boolean): currently reserved and not used to change runtime behavior.

The timeout is sent when the sandbox is created. A later `connect` does not refresh it. Exiting or detaching from the local CLI does not delete the sandbox; use `wipe`/`wipe-all` for explicit cleanup.

## `[startup]`

- `mode` (enum): default startup mode. Allowed values: `prompt|ssh-opencode|ssh-codex|ssh-claude|web|ssh-shell|ssh-custom`.
- `prompt` behavior: prompts in interactive terminals (accepts `1-6` or mode name), reprompts invalid input up to 3 times, then fails with an actionable error.
- Non-interactive fallback is `ssh-opencode`.

## `[agent]` (custom terminal agent)

`ssh-custom` is one project-defined terminal agent. It reuses the normal SSH/tmux lifecycle, but does not assume a particular provider, binary, or login flow. The launcher itself expects a POSIX sandbox with Bash, tmux, and `/home/user`; custom mode requires an explicit non-`base` `sandbox.template` that provides those dependencies plus the runtime packages your agent needs.

```toml
[sandbox]
template = "your-compatible-template"

[startup]
mode = "ssh-custom"

[agent]
command = ["my-agent", "--interactive"]
check_command = "command -v my-agent"
install_command = "npm install -g my-agent@1.2.3"
initial_prompt_command = ["my-agent", "--special-prompt-flag", "{prompt}"]
follow_up = "tmux"

[[agent.files]]
source = "~/.config/my-agent/auth.json"
destination = "/home/user/.config/my-agent/auth.json"
```

- `command` (string array): normal persistent-session argv. The array must be non-empty, its executable must be non-empty, and values cannot contain NUL bytes. It is not run on the host.
- `check_command` (string, optional): trusted shell command run in the sandbox before launch. Exit code `0` means available; any other exit code means missing. Its output is not copied to CLI errors.
- `install_command` (string, optional): trusted shell command run in the sandbox only after a configured check reports missing. Installation requires `check_command`; after installation the check runs again. A missing check or failed verification never reports the agent ready.
- `initial_prompt_command` (string array, optional): argv used only for a new `create` session with a prompt. It must contain exactly one `{prompt}` element as a whole argument, not as the executable, and its effective executable must match `agent.command`. Direct argv and a constrained `bash -c` positional wrapper are supported. A shell program cannot be `{prompt}` or contain `{prompt}`; the wrapper must put a `$0` label before the whole-argument placeholder so the prompt becomes quoted `"$1"` data. Without this field, initial prompt options fail clearly while a prompt-less launch still works.
- `follow_up` (currently only `"tmux"`, optional): explicitly enables `connect --prompt-file`/`--prompt-stdin` delivery through the existing tmux session. Without it, custom follow-ups fail rather than starting another process.
- `[[agent.files]]` (optional): explicit regular host-file mappings copied during custom `create` only. `source` supports the same `~`, `$HOME`, and `${HOME}` expansion as built-in sync. Sources are required unless `optional = true`; missing required files fail. Symlink sources are rejected. Destinations must be absolute paths below `/home/user`, cannot contain traversal or control characters, and are permission-restricted before custom bytes are written. Unrelated sandbox files are never pruned.

The placeholder is an argv contract, not shell interpolation. Use direct argv when possible:

```toml
initial_prompt_command = ["env", "AGENT_MODE=1", "my-agent", "--special-prompt-flag", "{prompt}"]
```

When a shell wrapper is required, the supported form is deliberately narrow: `bash -c`, one `exec` command made from plain shell-safe words, and one final quoted `"$1"`. Keep `{prompt}` out of the shell program and pass it after the `$0` label. Nested shells, operators, redirections, expansions, and unquoted `$1` are rejected:

```toml
initial_prompt_command = ["bash", "-c", "exec my-agent --flag \"$1\"", "wrapper", "{prompt}"]
```

Only the command/check/install strings are trusted configuration scripts. Prompt text remains data, including quotes, newlines, `$()`, backticks, semicolons, redirection characters, and leading dashes. Custom launch preflight measures UTF-8 bytes and rejects command argv over 16 KiB, prompts over 32 KiB, or startup environment over 32 KiB including a 4 KiB safety headroom; an initial prompt is also part of its substituted argv and therefore subject to the 16 KiB aggregate argv limit. Agent provider authentication is not universal: use `[env].pass_through` for selected environment variables, explicit file mappings for portable files, or log in inside the sandbox for keychains/browser/OAuth-bound credentials. Custom files are not refreshed on `connect`.

## `[project]`

- `mode` (enum): repo selection strategy. Allowed values: `single|all`.
- `active` (enum): single-repo chooser mode. Allowed values: `prompt|name|index`.
- `prompt` asks which repo to use when multiple repos are configured and a TTY is available.
- `active_name` (string): required when `active = "name"`; must match one configured `[[project.repos]].name`.
- `active_index` (number): required when `active = "index"`; zero-based repo index (`0` is the first repo).
- `dir` (string): parent workspace directory in the sandbox where repos are cloned.
- `working_dir` (string): launch cwd policy.
- `auto` (default): one selected/provisioned repo -> repo path, multiple repos -> `project.dir`, no repo -> unchanged.
- any non-empty path string: used as launch cwd; relative paths resolve under `project.dir`.
- `setup_on_connect` (boolean): when `true`, setup runs on `connect` even for already-cloned repos.
- `setup_retries` (number): retry count for `setup_command` after the first attempt (total attempts = `setup_retries + 1`).
- `setup_concurrency` (number): max number of repos whose `setup_command` can run concurrently. Default `1` (sequential, existing behavior). Must be an integer `>= 1`.
- `setup_continue_on_error` (boolean): when `true`, continue setup for other repos after a failure.
- `[[project.repos]]`: list of repos to clone/checkout/bootstrap.
- `name` (string): repo folder name under `project.dir`.
- `url` (string): git clone URL.
- `branch` (string): branch to checkout (defaults to `main` if omitted).
- `setup_command` (string): primary setup command users should configure.
- `setup_env` (table): string env vars injected into setup commands.
- `startup_env` (table): string env vars injected into launched startup mode only when exactly one repo is selected.

Setup for each selected repo runs `setup_command`.

If `create` is cancelled during interactive repo selection, ez-devbox automatically wipes the newly created sandbox.

When `project.working_dir = "auto"`, working directory behavior after repo selection/provisioning is:

- one selected repo: launch in that repo directory (`project.dir/<repo-name>`)
- multiple selected repos: launch in parent project directory (`project.dir`)

## `[env]`

- `pass_through` (string array): extra host env var names to forward into sandbox creation.
- Built-in pass-through vars are always considered as well: `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, `GH_TOKEN`.
- `OPENCODE_SERVER_PASSWORD` is scoped to web startup: ez-devbox injects it only when launching `startup.mode = "web"` (or `--mode web`).
- Add service-specific keys (for example Firecrawl) explicitly in `pass_through`.

## `[opencode]`

- `config_dir` (string): host OpenCode config directory to sync into `/home/user/.config/opencode` in sandbox.
- `auth_path` (string): host OpenCode auth file to sync into `/home/user/.local/share/opencode/auth.json` in sandbox.

## `[codex]`

- `config_dir` (string): host Codex config directory to sync into `/home/user/.codex` in sandbox.
- `auth_path` (string): host Codex auth file to sync into `/home/user/.codex/auth.json` in sandbox.

## `[claude]`

- `config_dir` (string): host Claude config directory to sync into `/home/user/.claude` in sandbox.
- `state_path` (string): host Claude state file to sync into `/home/user/.claude.json` in sandbox.
- Claude authentication commonly relies on browser-based login. In remote/SSH environments, this flow may require manual login inside the sandbox if host state sync is unavailable or stale.
- Treat Claude state artifacts as sensitive credentials and avoid syncing from untrusted hosts.

## `[gh]`

- `enabled` (boolean): enables GitHub CLI config sync into the sandbox and GitHub auth token injection for bootstrap/launch runtime (`GH_TOKEN` -> `GITHUB_TOKEN` -> `gh auth token`). Default: `false` (off).
- `config_dir` (string): host GitHub CLI config directory to sync into `/home/user/.config/gh` in sandbox when enabled. Auth-state files that trigger host keyring migration (`hosts.yml`) are intentionally excluded; sandbox GitHub auth still comes from injected `GH_TOKEN`/`GITHUB_TOKEN`.

## `[tunnel]`

- `ports` (number array): local TCP ports to expose with temporary cloudflared tunnels.
- `[]` disables tunnel management.
- Each value `1-65535` starts one tunnel to `http://127.0.0.1:<port>` for `create/connect/start/command`.
- `targets` (table, optional): per-port upstream URL override.
- Keys are stringified port numbers (for example `"3002"`), values are `http://` or `https://` URLs.
- When `targets` is set, its keys are authoritative for which tunnel ports are started.
- URL safety constraints: no credentials, no path, no query string, no fragment.
- Example:
  ```toml
  [tunnel]

  [tunnel.targets]
  "3002" = "http://10.0.0.20:3002"
  ```
- Docker fallback rewrites only localhost-style upstreams (`127.0.0.1`, `localhost`, `0.0.0.0`) to `host.docker.internal`; remote hosts/IPs are kept unchanged.
- Runtime exports generic env vars: `EZ_DEVBOX_TUNNEL_<PORT>_URL`, `EZ_DEVBOX_TUNNELS_JSON`, and `EZ_DEVBOX_TUNNEL_PORTS`; `EZ_DEVBOX_TUNNEL_URL` is set only when exactly one tunnel is active.
- On `create`, ez-devbox emits a warning reminding that anyone with a tunnel URL can access the forwarded service.
- Quick tunnels run on the host only for the enclosing CLI operation and are stopped when it completes or receives a handled termination signal. Their public URLs are unauthenticated bearer links unless the upstream service enforces authentication.
- Runtime prefers local `cloudflared`; if missing, it falls back to `docker run cloudflare/cloudflared:2024.11.0`.
