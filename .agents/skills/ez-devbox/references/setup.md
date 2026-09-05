# Install and configure

Requires Node.js 20+, an E2B API key, and `ssh` for SSH modes. macOS and Linux are supported; Windows host SSH/tunnel workflows are not tested in CI.

```bash
npm install -g ez-devbox
ez-devbox --help
```

Alternatively, use `npx ez-devbox` without a global install.

Set `E2B_API_KEY` in the host environment or a project-local `.env` file. Keep `.env` out of version control. Configure the selected agent's credentials through local auth/config sync or provider environment variables.

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

## Common settings

- `[startup].mode`: `ssh-opencode`, `ssh-codex`, `ssh-claude`, `ssh-shell`, or `web`. Override with `--mode`.
- `[[project.repos]]`: repositories and setup commands. Use `[project].mode = "all"` to provision multiple repos; `working_dir` controls the launch directory.
- `[env].pass_through`: extra host environment variable names to forward. `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GITHUB_TOKEN`, and `GH_TOKEN` are already considered for forwarding.
- `[opencode]` and `[codex]`: `config_dir` and `auth_path` select local files to sync at creation. `[claude]` uses `config_dir` and `state_path`.
- `[gh].enabled = true`: enables GitHub CLI config sync and token injection for private repositories.
- `[tunnel].ports`: local ports to expose through cloudflared; requires local `cloudflared` or Docker. An empty array disables tunnels.

The sandbox timeout applies at creation; reconnecting does not reset it. Detaching leaves the sandbox running until timeout or explicit cleanup.

See the [complete config reference](https://github.com/shanebishop1/ez-devbox/blob/main/docs/launcher-config-reference.md) for all fields and the [minimal example](https://github.com/shanebishop1/ez-devbox/blob/main/examples/minimal/ez-devbox.config.toml) for a public-repo setup.

Once configured, follow [sessions.md](sessions.md) to create and reconnect to a session.
