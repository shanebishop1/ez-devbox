# Install and configure

Requires Node.js 20+, an E2B API key, and `ssh` for SSH modes. macOS and Linux are supported; Windows host SSH/tunnel workflows are not tested in CI.

```bash
npm install -g ez-devbox@latest
ez-devbox --version
ez-devbox --help
```

Alternatively, replace `ez-devbox` in every example with `npx --yes ez-devbox@latest`; no global install or source checkout is needed. Global installation also provides the `ezdb` alias.

Obtain an API key from your E2B account. Set `E2B_API_KEY` in the host environment or a project-local `.env` file:

```dotenv
E2B_API_KEY=your_e2b_key
```

Keep `.env` out of version control and never print credentials. E2B credentials provision the devbox; the selected agent needs its own login or provider credentials below.

## Project config

Create `ez-devbox.config.toml` in the directory where you run the CLI. Adjust the repository, branch, and setup command:

```toml
[sandbox]
template = "opencode"
name = "devbox"
timeout_ms = 3600000

[startup]
mode = "ssh-codex"

[project]
mode = "single"
active = "prompt"

[[project.repos]]
name = "your-repo"
url = "https://github.com/your-org/your-repo.git"
branch = "main"
setup_command = "npm install"
```

Config lookup is local first, then `~/.config/ez-devbox/ez-devbox.config.toml` on macOS/Linux or `%APPDATA%\ez-devbox\ez-devbox.config.toml` on Windows. If neither exists, an interactive terminal offers to create one; non-interactive runs require an existing config.

## Agent credentials

Log into the selected agent locally before `create`, or supply supported provider credentials. Creation syncs that mode's existing local files; `connect` does not resync auth/config. Defaults can be overridden with these TOML sections:

```toml
[opencode]
config_dir = "~/.config/opencode"
auth_path = "~/.local/share/opencode/auth.json"

[codex]
config_dir = "~/.codex"
auth_path = "~/.codex/auth.json"

[claude]
config_dir = "~/.claude"
state_path = "~/.claude.json"
```

`OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, and `GH_TOKEN` are forwarded when present on the host. For other provider variables, add `[env]` with `pass_through = ["YOUR_PROVIDER_API_KEY"]`. For private repositories, supply `GH_TOKEN` or `GITHUB_TOKEN`; `[gh]` with `enabled = true` additionally enables GitHub CLI config sync and host-token discovery. Use only trusted templates/repos: synced files and forwarded variables make the sandbox credential-bearing.

For `web`, also set a nonempty `OPENCODE_SERVER_PASSWORD` in `.env` or the shell before starting a new listener. This protects browser access; it is not an agent provider key.

## Common settings

- `[startup].mode`: `ssh-opencode`, `ssh-codex`, `ssh-claude`, `ssh-shell`, or `web`. Override with `--mode`.
- Repeat `[[project.repos]]` for multiple repos. `[project].mode = "all"` provisions all; for one deterministic repo use `mode = "single"`, `active = "name"`, and `active_name = "your-repo"`. Avoid interactive selection in automation.
- `[project].dir` defaults to `/home/user/projects/workspace`; each repo is cloned under its `name`. `working_dir = "auto"` launches in the single selected repo, or the workspace for multiple repos. `setup_on_connect = false` avoids rerunning setup on reconnect (the default).
- `[tunnel]` with `ports = [3000]` exposes local services to the sandbox through cloudflared; requires local `cloudflared` or Docker. Default `ports = []` disables tunnels. Tunnel URLs are bearer links: require upstream authentication for sensitive services.

The sandbox timeout applies at creation; reconnecting does not reset it. Detaching leaves the sandbox running until timeout or explicit cleanup.

Once configured, follow [sessions.md](sessions.md) to create and reconnect to a session.
