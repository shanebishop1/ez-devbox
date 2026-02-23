import type { ResolvedLauncherConfig } from "./schema.js";

export const defaultConfig: ResolvedLauncherConfig = {
  sandbox: {
    template: "base",
    reuse: true,
    name: "agent-box",
    timeout_ms: 60 * 60 * 1000,
    delete_on_exit: false
  },
  startup: {
    mode: "prompt"
  },
  project: {
    mode: "single",
    active: "prompt",
    dir: "/home/daytona/projects/workspace",
    setup_on_connect: false,
    setup_retries: 2,
    setup_continue_on_error: false,
    repos: []
  },
  env: {
    pass_through: []
  },
  mcp: {
    mode: "disabled",
    firecrawl_api_url: "",
    allow_localhost_override: false
  }
};
