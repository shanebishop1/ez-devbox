import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseDotEnv } from "dotenv";
import { parse as parseToml } from "smol-toml";
import type { ResolvedLauncherConfig } from "./schema.js";
import { defaultConfig } from "./defaults.js";
import { validateFirecrawlPreflight } from "../mcp/firecrawl.js";

type JsonRecord = Record<string, unknown>;

export interface LoadConfigOptions {
  configPath?: string;
  envPath?: string;
}

const STARTUP_MODES = ["prompt", "ssh-opencode", "ssh-codex", "web", "ssh-shell"] as const;
const PROJECT_MODES = ["single", "all"] as const;
const PROJECT_ACTIVE_MODES = ["prompt", "name", "index"] as const;
const MCP_MODES = ["disabled", "remote_url", "in_sandbox"] as const;

export async function loadConfig(options: LoadConfigOptions = {}): Promise<ResolvedLauncherConfig> {
  const configPath = options.configPath ?? resolve(process.cwd(), "launcher.config.toml");
  const envPath = options.envPath ?? resolve(process.cwd(), ".env");

  const rawConfig = await readTomlConfig(configPath);
  const parsedEnv = await readEnvFile(envPath);
  const mergedEnv = {
    ...parsedEnv,
    ...process.env
  };

  const e2bApiKey = mergedEnv.E2B_API_KEY;
  if (typeof e2bApiKey !== "string" || e2bApiKey.trim() === "") {
    throw new Error(
      "Invalid env.E2B_API_KEY: required value is missing. Set E2B_API_KEY in process env or .env."
    );
  }

  const sandboxRaw = getOptionalTable(rawConfig, "sandbox", "sandbox");
  const startupRaw = getOptionalTable(rawConfig, "startup", "startup");
  const projectRaw = getOptionalTable(rawConfig, "project", "project");
  const envRaw = getOptionalTable(rawConfig, "env", "env");
  const opencodeRaw = getOptionalTable(rawConfig, "opencode", "opencode");
  const codexRaw = getOptionalTable(rawConfig, "codex", "codex");
  const mcpRaw = getOptionalTable(rawConfig, "mcp", "mcp");

  const projectReposRaw =
    projectRaw === undefined ? undefined : getOptionalArray(projectRaw, "repos", "project.repos");

  const resolved: ResolvedLauncherConfig = {
    sandbox: {
      template: getOptionalString(sandboxRaw, "template", "sandbox.template") ?? defaultConfig.sandbox.template,
      reuse: getOptionalBoolean(sandboxRaw, "reuse", "sandbox.reuse") ?? defaultConfig.sandbox.reuse,
      name: getOptionalString(sandboxRaw, "name", "sandbox.name") ?? defaultConfig.sandbox.name,
      timeout_ms:
        getOptionalNumber(sandboxRaw, "timeout_ms", "sandbox.timeout_ms") ?? defaultConfig.sandbox.timeout_ms,
      delete_on_exit:
        getOptionalBoolean(sandboxRaw, "delete_on_exit", "sandbox.delete_on_exit") ??
        defaultConfig.sandbox.delete_on_exit
    },
    startup: {
      mode:
        getOptionalEnum(startupRaw, "mode", "startup.mode", STARTUP_MODES) ?? defaultConfig.startup.mode
    },
    project: {
      mode: getOptionalEnum(projectRaw, "mode", "project.mode", PROJECT_MODES) ?? defaultConfig.project.mode,
      active:
        getOptionalEnum(projectRaw, "active", "project.active", PROJECT_ACTIVE_MODES) ??
        defaultConfig.project.active,
      dir: getOptionalString(projectRaw, "dir", "project.dir") ?? defaultConfig.project.dir,
      setup_on_connect:
        getOptionalBoolean(projectRaw, "setup_on_connect", "project.setup_on_connect") ??
        defaultConfig.project.setup_on_connect,
      setup_retries:
        getOptionalNumber(projectRaw, "setup_retries", "project.setup_retries") ??
        defaultConfig.project.setup_retries,
      setup_continue_on_error:
        getOptionalBoolean(projectRaw, "setup_continue_on_error", "project.setup_continue_on_error") ??
        defaultConfig.project.setup_continue_on_error,
      repos: resolveRepos(projectReposRaw)
    },
    env: {
      pass_through:
        getOptionalStringArray(envRaw, "pass_through", "env.pass_through") ?? defaultConfig.env.pass_through
    },
    opencode: {
      config_dir:
        getOptionalString(opencodeRaw, "config_dir", "opencode.config_dir") ?? defaultConfig.opencode.config_dir,
      auth_path:
        getOptionalString(opencodeRaw, "auth_path", "opencode.auth_path") ?? defaultConfig.opencode.auth_path
    },
    codex: {
      config_dir: getOptionalString(codexRaw, "config_dir", "codex.config_dir") ?? defaultConfig.codex.config_dir,
      auth_path: getOptionalString(codexRaw, "auth_path", "codex.auth_path") ?? defaultConfig.codex.auth_path
    },
    mcp: {
      mode: getOptionalEnum(mcpRaw, "mode", "mcp.mode", MCP_MODES) ?? defaultConfig.mcp.mode,
      firecrawl_api_url:
        getOptionalString(mcpRaw, "firecrawl_api_url", "mcp.firecrawl_api_url") ??
        (typeof mergedEnv.FIRECRAWL_API_URL === "string" ? mergedEnv.FIRECRAWL_API_URL : defaultConfig.mcp.firecrawl_api_url),
      allow_localhost_override:
        getOptionalBoolean(mcpRaw, "allow_localhost_override", "mcp.allow_localhost_override") ??
        defaultConfig.mcp.allow_localhost_override
    }
  };

  if (resolved.sandbox.timeout_ms <= 0 || !Number.isInteger(resolved.sandbox.timeout_ms)) {
    throw new Error("Invalid sandbox.timeout_ms: expected a positive integer in milliseconds.");
  }

  if (resolved.project.setup_retries < 0 || !Number.isInteger(resolved.project.setup_retries)) {
    throw new Error("Invalid project.setup_retries: expected an integer greater than or equal to 0.");
  }

  validateFirecrawlPreflight(resolved, mergedEnv);

  return resolved;
}

async function readTomlConfig(configPath: string): Promise<JsonRecord> {
  let source: string;
  try {
    source = await readFile(configPath, "utf8");
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      throw new Error(`Cannot load launcher config at '${configPath}': file does not exist.`);
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = parseToml(source);
  } catch (error) {
    throw new Error(`Cannot parse launcher config at '${configPath}': ${(error as Error).message}`);
  }

  if (!isRecord(parsed)) {
    throw new Error("Invalid launcher config root: expected a TOML table.");
  }

  return parsed;
}

async function readEnvFile(envPath: string): Promise<Record<string, string>> {
  try {
    const source = await readFile(envPath, "utf8");
    return parseDotEnv(source);
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return {};
    }
    throw new Error(`Cannot read env file at '${envPath}': ${(error as Error).message}`);
  }
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
      branch:
        getOptionalString(entry, "branch", `project.repos[${index}].branch`) ??
        "main",
      setup_pre_command:
        getOptionalString(entry, "setup_pre_command", `project.repos[${index}].setup_pre_command`) ??
        "",
      setup_command:
        getOptionalString(entry, "setup_command", `project.repos[${index}].setup_command`) ??
        "",
      setup_wrapper_command:
        getOptionalString(entry, "setup_wrapper_command", `project.repos[${index}].setup_wrapper_command`) ??
        "",
      setup_env:
        getOptionalStringRecord(entry, "setup_env", `project.repos[${index}].setup_env`) ?? {},
      startup_env:
        getOptionalStringRecord(entry, "startup_env", `project.repos[${index}].startup_env`) ?? {}
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
  values: T
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

function getOptionalStringArray(
  parent: JsonRecord | undefined,
  key: string,
  path: string
): string[] | undefined {
  const value = parent?.[key];
  if (value === undefined) {
    return undefined;
  }
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    throw new Error(`Invalid ${path}: expected an array of strings.`);
  }
  return [...value];
}

function getOptionalStringRecord(
  parent: JsonRecord,
  key: string,
  path: string
): Record<string, string> | undefined {
  const value = parent[key];
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

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
