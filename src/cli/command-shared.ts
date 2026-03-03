import type { BootstrapProjectWorkspaceResult } from "../project/bootstrap.js";
import type { StartupMode } from "../types/index.js";

const OPENCODE_SERVER_PASSWORD_ENV_VAR = "OPENCODE_SERVER_PASSWORD";

export function removeOpenCodeServerPassword(envs: Record<string, string>): Record<string, string> {
  const { [OPENCODE_SERVER_PASSWORD_ENV_VAR]: _ignored, ...rest } = envs;
  return rest;
}

export function resolveWebServerPassword(envSource: Record<string, string | undefined>): string | undefined {
  const value = envSource[OPENCODE_SERVER_PASSWORD_ENV_VAR]?.trim();
  return value ? value : undefined;
}

export function addWebServerPasswordForWebMode(
  startupEnv: Record<string, string>,
  mode: "ssh-opencode" | "ssh-codex" | "web" | "ssh-shell",
  webServerPassword: string | undefined
): Record<string, string> {
  const base = removeOpenCodeServerPassword(startupEnv);
  if (mode !== "web" || webServerPassword === undefined) {
    return base;
  }

  return {
    ...base,
    [OPENCODE_SERVER_PASSWORD_ENV_VAR]: webServerPassword
  };
}

export function formatSelectedReposSummary(selectedRepoNames: string[]): string {
  if (selectedRepoNames.length === 0) {
    return "none";
  }
  return selectedRepoNames.join(", ");
}

export function formatSetupOutcomeSummary(setup: BootstrapProjectWorkspaceResult["setup"]): string {
  if (setup === null) {
    return "skipped";
  }

  return `ran success=${setup.success} repos=${setup.repos.length}`;
}

export function parseStartupModeValue(value: string | undefined): StartupMode {
  if (!isStartupMode(value)) {
    throw new Error("Invalid value for --mode. Expected one of prompt|ssh-opencode|ssh-codex|web|ssh-shell.");
  }

  return value;
}

function isStartupMode(value: string | undefined): value is StartupMode {
  return value === "prompt" || value === "ssh-opencode" || value === "ssh-codex" || value === "web" || value === "ssh-shell";
}
