import { defaultConfig } from "./defaults.js";
import type { JsonRecord } from "./load.types.js";
import type { ResolvedLauncherConfig } from "./schema.js";

const STARTUP_MODES = ["prompt", "ssh-opencode", "ssh-codex", "ssh-claude", "web", "ssh-shell"] as const;
const PROJECT_MODES = ["single", "all"] as const;
const PROJECT_ACTIVE_MODES = ["prompt", "name", "index"] as const;

export function parseRawLauncherConfig(rawConfig: JsonRecord): ResolvedLauncherConfig {
  const sandboxRaw = getOptionalTable(rawConfig, "sandbox", "sandbox");
  const startupRaw = getOptionalTable(rawConfig, "startup", "startup");
  const projectRaw = getOptionalTable(rawConfig, "project", "project");
  const envRaw = getOptionalTable(rawConfig, "env", "env");
  const opencodeRaw = getOptionalTable(rawConfig, "opencode", "opencode");
  const codexRaw = getOptionalTable(rawConfig, "codex", "codex");
  const claudeRaw = getOptionalTable(rawConfig, "claude", "claude");
  const ghRaw = getOptionalTable(rawConfig, "gh", "gh");
  const tunnelRaw = getOptionalTable(rawConfig, "tunnel", "tunnel");

  const projectReposRaw = projectRaw === undefined ? undefined : getOptionalArray(projectRaw, "repos", "project.repos");

  return {
    sandbox: {
      template: getOptionalString(sandboxRaw, "template", "sandbox.template") ?? defaultConfig.sandbox.template,
      reuse: getOptionalBoolean(sandboxRaw, "reuse", "sandbox.reuse") ?? defaultConfig.sandbox.reuse,
      name: getOptionalString(sandboxRaw, "name", "sandbox.name") ?? defaultConfig.sandbox.name,
      timeout_ms: getOptionalNumber(sandboxRaw, "timeout_ms", "sandbox.timeout_ms") ?? defaultConfig.sandbox.timeout_ms,
      delete_on_exit:
        getOptionalBoolean(sandboxRaw, "delete_on_exit", "sandbox.delete_on_exit") ??
        defaultConfig.sandbox.delete_on_exit,
    },
    startup: {
      mode: getOptionalEnum(startupRaw, "mode", "startup.mode", STARTUP_MODES) ?? defaultConfig.startup.mode,
    },
    project: {
      mode: getOptionalEnum(projectRaw, "mode", "project.mode", PROJECT_MODES) ?? defaultConfig.project.mode,
      active:
        getOptionalEnum(projectRaw, "active", "project.active", PROJECT_ACTIVE_MODES) ?? defaultConfig.project.active,
      active_name:
        getOptionalString(projectRaw, "active_name", "project.active_name") ?? defaultConfig.project.active_name,
      active_index:
        getOptionalNumber(projectRaw, "active_index", "project.active_index") ?? defaultConfig.project.active_index,
      dir: getOptionalString(projectRaw, "dir", "project.dir") ?? defaultConfig.project.dir,
      working_dir:
        getOptionalString(projectRaw, "working_dir", "project.working_dir") ?? defaultConfig.project.working_dir,
      setup_on_connect:
        getOptionalBoolean(projectRaw, "setup_on_connect", "project.setup_on_connect") ??
        defaultConfig.project.setup_on_connect,
      setup_retries:
        getOptionalNumber(projectRaw, "setup_retries", "project.setup_retries") ?? defaultConfig.project.setup_retries,
      setup_concurrency:
        getOptionalNumber(projectRaw, "setup_concurrency", "project.setup_concurrency") ??
        defaultConfig.project.setup_concurrency,
      setup_continue_on_error:
        getOptionalBoolean(projectRaw, "setup_continue_on_error", "project.setup_continue_on_error") ??
        defaultConfig.project.setup_continue_on_error,
      repos: resolveRepos(projectReposRaw),
    },
    env: {
      pass_through:
        getOptionalStringArray(envRaw, "pass_through", "env.pass_through") ?? defaultConfig.env.pass_through,
    },
    opencode: {
      config_dir:
        getOptionalString(opencodeRaw, "config_dir", "opencode.config_dir") ?? defaultConfig.opencode.config_dir,
      auth_path: getOptionalString(opencodeRaw, "auth_path", "opencode.auth_path") ?? defaultConfig.opencode.auth_path,
      ...(getOptionalBoolean(opencodeRaw, "match_local_version", "opencode.match_local_version") !== undefined
        ? {
            match_local_version: getOptionalBoolean(opencodeRaw, "match_local_version", "opencode.match_local_version"),
          }
        : {}),
    },
    codex: {
      config_dir: getOptionalString(codexRaw, "config_dir", "codex.config_dir") ?? defaultConfig.codex.config_dir,
      auth_path: getOptionalString(codexRaw, "auth_path", "codex.auth_path") ?? defaultConfig.codex.auth_path,
    },
    claude: {
      config_dir: getOptionalString(claudeRaw, "config_dir", "claude.config_dir") ?? defaultConfig.claude.config_dir,
      state_path: getOptionalString(claudeRaw, "state_path", "claude.state_path") ?? defaultConfig.claude.state_path,
    },
    gh: {
      enabled: getOptionalBoolean(ghRaw, "enabled", "gh.enabled") ?? defaultConfig.gh.enabled,
      config_dir: getOptionalString(ghRaw, "config_dir", "gh.config_dir") ?? defaultConfig.gh.config_dir,
    },
    tunnel: {
      ports: getOptionalNumberArray(tunnelRaw, "ports", "tunnel.ports") ?? defaultConfig.tunnel.ports,
      targets: getOptionalStringRecord(tunnelRaw, "targets", "tunnel.targets") ?? defaultConfig.tunnel.targets,
    },
  };
}

function resolveRepos(rawRepos: unknown[] | undefined): ResolvedLauncherConfig["project"]["repos"] {
  if (rawRepos === undefined) {
    return defaultConfig.project.repos;
  }

  return rawRepos.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Invalid project.repos[${index}]: expected a TOML table.`);
    }

    return {
      name: getRequiredString(entry, "name", `project.repos[${index}].name`),
      url: getRequiredString(entry, "url", `project.repos[${index}].url`),
      branch: getOptionalString(entry, "branch", `project.repos[${index}].branch`) ?? "main",
      setup_command: getOptionalString(entry, "setup_command", `project.repos[${index}].setup_command`) ?? "",
      setup_env: getOptionalStringRecord(entry, "setup_env", `project.repos[${index}].setup_env`) ?? {},
      startup_env: getOptionalStringRecord(entry, "startup_env", `project.repos[${index}].startup_env`) ?? {},
    };
  });
}

function getOptionalTable(parent: JsonRecord, key: string, path: string): JsonRecord | undefined {
  const value = parent[key];
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error(`Invalid ${path}: expected a TOML table.`);
  }
  return value;
}

function getOptionalArray(parent: JsonRecord, key: string, path: string): unknown[] | undefined {
  const value = parent[key];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value)) {
    throw new Error(`Invalid ${path}: expected an array.`);
  }
  return value;
}

function getOptionalString(parent: JsonRecord | undefined, key: string, path: string): string | undefined {
  const value = parent?.[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string") {
    throw new Error(`Invalid ${path}: expected a string.`);
  }
  return value;
}

function getRequiredString(parent: JsonRecord, key: string, path: string): string {
  const value = getOptionalString(parent, key, path);
  if (value === undefined || value.trim() === "") {
    throw new Error(`Invalid ${path}: required non-empty string is missing.`);
  }
  return value;
}

function getOptionalNumber(parent: JsonRecord | undefined, key: string, path: string): number | undefined {
  const value = parent?.[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || Number.isNaN(value)) {
    throw new Error(`Invalid ${path}: expected a number.`);
  }
  return value;
}

function getOptionalBoolean(parent: JsonRecord | undefined, key: string, path: string): boolean | undefined {
  const value = parent?.[key];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "boolean") {
    throw new Error(`Invalid ${path}: expected a boolean.`);
  }
  return value;
}

function getOptionalEnum<T extends readonly string[]>(
  parent: JsonRecord | undefined,
  key: string,
  path: string,
  values: T,
): T[number] | undefined {
  const value = getOptionalString(parent, key, path);
  if (value === undefined) {
    return undefined;
  }
  if (!values.includes(value)) {
    throw new Error(`Invalid ${path}: expected one of ${values.join("|")}.`);
  }
  return value as T[number];
}

function getOptionalStringArray(parent: JsonRecord | undefined, key: string, path: string): string[] | undefined {
  const value = parent?.[key];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`Invalid ${path}: expected an array of strings.`);
  }
  return [...value];
}

function getOptionalNumberArray(parent: JsonRecord | undefined, key: string, path: string): number[] | undefined {
  const value = parent?.[key];
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || !value.every((item) => typeof item === "number" && !Number.isNaN(item))) {
    throw new Error(`Invalid ${path}: expected an array of numbers.`);
  }

  return [...value];
}

function getOptionalStringRecord(
  parent: JsonRecord | undefined,
  key: string,
  path: string,
): Record<string, string> | undefined {
  const value = parent?.[key];
  if (value === undefined) {
    return undefined;
  }
  if (!isRecord(value)) {
    throw new Error(`Invalid ${path}: expected a table of string values.`);
  }

  const entries = Object.entries(value);
  for (const [entryKey, entryValue] of entries) {
    if (typeof entryValue !== "string") {
      throw new Error(`Invalid ${path}.${entryKey}: expected a string.`);
    }
  }

  return Object.fromEntries(entries) as Record<string, string>;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
