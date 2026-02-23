import type { StartupMode } from "../types/index.js";

export type ProjectMode = "single" | "all";
export type ProjectActiveMode = "prompt" | "name" | "index";
export type McpMode = "disabled" | "remote_url" | "in_sandbox";

export interface ResolvedProjectRepoConfig {
  name: string;
  url: string;
  branch: string;
  setup_pre_command: string;
  setup_command: string;
  setup_wrapper_command: string;
  setup_env: Record<string, string>;
  startup_env: Record<string, string>;
}

export interface ResolvedLauncherConfig {
  sandbox: {
    template: string;
    reuse: boolean;
    name: string;
    timeout_ms: number;
    delete_on_exit: boolean;
  };
  startup: {
    mode: StartupMode;
  };
  project: {
    mode: ProjectMode;
    active: ProjectActiveMode;
    dir: string;
    setup_on_connect: boolean;
    setup_retries: number;
    setup_continue_on_error: boolean;
    repos: ResolvedProjectRepoConfig[];
  };
  env: {
    pass_through: string[];
  };
  opencode: {
    config_dir: string;
    auth_path: string;
  };
  codex: {
    config_dir: string;
    auth_path: string;
  };
  mcp: {
    mode: McpMode;
    firecrawl_api_url: string;
    allow_localhost_override: boolean;
  };
}
