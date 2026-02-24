import type { ResolvedLauncherConfig } from "./schema.js";

export const defaultConfig: ResolvedLauncherConfig = {
  sandbox: {
    template: "opencode",
    reuse: true,
    name: "ez-devbox",
    timeout_ms: 60 * 60 * 1000,
    delete_on_exit: false
  },
  startup: {
    mode: "prompt"
  },
  project: {
    mode: "single",
    active: "prompt",
    dir: "/home/user/projects/workspace",
    working_dir: "auto",
    setup_on_connect: false,
    setup_retries: 2,
    setup_continue_on_error: false,
    repos: []
  },
  env: {
    pass_through: []
  },
  opencode: {
    config_dir: "~/.config/opencode",
    auth_path: "~/.local/share/opencode/auth.json"
  },
  codex: {
    config_dir: "~/.codex",
    auth_path: "~/.codex/auth.json"
  },
  gh: {
    enabled: false,
    config_dir: "~/.config/gh"
  },
  tunnel: {
    ports: []
  }
};
