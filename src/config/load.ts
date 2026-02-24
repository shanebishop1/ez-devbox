import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { parse as parseDotEnv } from "dotenv";
import { parse as parseToml } from "smol-toml";
import { normalizePromptCancelledError } from "../cli/prompt-cancelled.js";
import type { ResolvedLauncherConfig } from "./schema.js";
import { defaultConfig } from "./defaults.js";

type JsonRecord = Record<string, unknown>;

export interface LoadConfigOptions {
  configPath?: string;
  envPath?: string;
  cwd?: string;
  isInteractiveTerminal?: () => boolean;
  promptInput?: (question: string) => Promise<string>;
  platform?: NodeJS.Platform;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
}

export interface LoadedLauncherConfig {
  config: ResolvedLauncherConfig;
  configPath: string;
  createdConfig: boolean;
  scope: "local" | "global";
}

const STARTUP_MODES = ["prompt", "ssh-opencode", "ssh-codex", "web", "ssh-shell"] as const;
const PROJECT_MODES = ["single", "all"] as const;
const PROJECT_ACTIVE_MODES = ["prompt", "name", "index"] as const;
const LAUNCHER_CONFIG_FILENAME = "launcher.config.toml";
const CONFIG_PROMPT_DEFAULT_SCOPE: LoadedLauncherConfig["scope"] = "local";
const DEFAULT_LAUNCHER_CONFIG = [
  "[sandbox]",
  'template = "opencode"',
  'name = "ez-devbox"',
  "",
  "[startup]",
  'mode = "prompt"',
  "",
  "[project]",
  'mode = "single"',
  'active = "prompt"',
  ""
].join("\n");

export async function loadConfig(options: LoadConfigOptions = {}): Promise<ResolvedLauncherConfig> {
  const loaded = await loadConfigWithMetadata(options);
  return loaded.config;
}

export async function loadConfigWithMetadata(options: LoadConfigOptions = {}): Promise<LoadedLauncherConfig> {
  const cwd = options.cwd ?? process.cwd();
  const resolvedPath = await resolveLauncherConfigPath(options);
  const configPath = resolvedPath.path;
  const envPath = options.envPath ?? resolve(cwd, ".env");

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
  const ghRaw = getOptionalTable(rawConfig, "gh", "gh");
  const tunnelRaw = getOptionalTable(rawConfig, "tunnel", "tunnel");

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
      working_dir:
        getOptionalString(projectRaw, "working_dir", "project.working_dir") ?? defaultConfig.project.working_dir,
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
    gh: {
      enabled: getOptionalBoolean(ghRaw, "enabled", "gh.enabled") ?? defaultConfig.gh.enabled,
      config_dir: getOptionalString(ghRaw, "config_dir", "gh.config_dir") ?? defaultConfig.gh.config_dir
    },
    tunnel: {
      ports: getOptionalNumberArray(tunnelRaw, "ports", "tunnel.ports") ?? defaultConfig.tunnel.ports
    }
  };

  if (resolved.sandbox.timeout_ms <= 0 || !Number.isInteger(resolved.sandbox.timeout_ms)) {
    throw new Error("Invalid sandbox.timeout_ms: expected a positive integer in milliseconds.");
  }

  if (resolved.project.setup_retries < 0 || !Number.isInteger(resolved.project.setup_retries)) {
    throw new Error("Invalid project.setup_retries: expected an integer greater than or equal to 0.");
  }

  if (resolved.project.working_dir !== "auto" && resolved.project.working_dir.trim() === "") {
    throw new Error("Invalid project.working_dir: expected 'auto' or a non-empty path string.");
  }

  if (resolved.gh.config_dir.trim() === "") {
    throw new Error("Invalid gh.config_dir: expected a non-empty path string.");
  }

  const seenTunnelPorts = new Set<number>();
  for (const [index, port] of resolved.tunnel.ports.entries()) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error(`Invalid tunnel.ports[${index}]: expected an integer between 1 and 65535.`);
    }

    if (seenTunnelPorts.has(port)) {
      throw new Error(`Invalid tunnel.ports[${index}]: duplicate port '${port}' is not allowed.`);
    }

    seenTunnelPorts.add(port);
  }

  return {
    config: resolved,
    configPath,
    createdConfig: resolvedPath.created,
    scope: resolvedPath.scope
  };
}

async function resolveLauncherConfigPath(
  options: LoadConfigOptions
): Promise<{ path: string; created: boolean; scope: LoadedLauncherConfig["scope"] }> {
  if (options.configPath) {
    return {
      path: options.configPath,
      created: false,
      scope: "local"
    };
  }

  const cwd = options.cwd ?? process.cwd();
  const localPath = resolve(cwd, LAUNCHER_CONFIG_FILENAME);
  const globalPath = getGlobalLauncherConfigPath(options);

  if (await pathExists(localPath)) {
    return {
      path: localPath,
      created: false,
      scope: "local"
    };
  }

  if (await pathExists(globalPath)) {
    return {
      path: globalPath,
      created: false,
      scope: "global"
    };
  }

  const isInteractiveTerminal = options.isInteractiveTerminal ?? (() => Boolean(process.stdin.isTTY && process.stdout.isTTY));
  if (!isInteractiveTerminal()) {
    throw new Error(
      [
        "Cannot load launcher config: no config file was found.",
        `Create one at '${localPath}' or '${globalPath}'.`,
        "Run from an interactive terminal to create a starter config automatically."
      ].join(" ")
    );
  }

  const prompt = options.promptInput ?? promptInput;
  const scope = await promptForConfigScope(localPath, globalPath, prompt);
  if (!scope) {
    throw new Error("Launcher config initialization cancelled.");
  }

  const selectedPath = scope === "local" ? localPath : globalPath;
  await mkdir(dirname(selectedPath), { recursive: true });
  let created = false;
  try {
    await writeFile(selectedPath, DEFAULT_LAUNCHER_CONFIG, { encoding: "utf8", flag: "wx" });
    created = true;
  } catch (error) {
    if (!(isErrnoException(error) && error.code === "EEXIST")) {
      throw error;
    }
  }

  return {
    path: selectedPath,
    created,
    scope
  };
}

function getGlobalLauncherConfigPath(options: LoadConfigOptions): string {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const resolvedHomeDir = options.homeDir ?? homedir();

  if (platform === "win32") {
    const appData = typeof env.APPDATA === "string" && env.APPDATA.trim() !== "" ? env.APPDATA : join(resolvedHomeDir, "AppData", "Roaming");
    return resolve(appData, "ez-devbox", LAUNCHER_CONFIG_FILENAME);
  }

  const xdgConfigHome = typeof env.XDG_CONFIG_HOME === "string" && env.XDG_CONFIG_HOME.trim() !== "" ? env.XDG_CONFIG_HOME : join(resolvedHomeDir, ".config");
  return resolve(xdgConfigHome, "ez-devbox", LAUNCHER_CONFIG_FILENAME);
}

async function promptForConfigScope(
  localPath: string,
  globalPath: string,
  prompt: (question: string) => Promise<string>
): Promise<LoadedLauncherConfig["scope"] | undefined> {
  const question = [
    "No launcher config found. Where should ez-devbox create one?",
    `1) Local (current directory): ${localPath}`,
    `2) Global (user config): ${globalPath}`,
    "3) Cancel",
    `Enter choice [1/${CONFIG_PROMPT_DEFAULT_SCOPE}]: `
  ].join("\n");
  const answer = (await prompt(question)).trim().toLowerCase();

  if (answer === "" || answer === "1" || answer === "local") {
    return "local";
  }

  if (answer === "2" || answer === "global") {
    return "global";
  }

  if (answer === "3" || answer === "cancel") {
    return undefined;
  }

  return CONFIG_PROMPT_DEFAULT_SCOPE;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function promptInput(question: string): Promise<string> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    return await readline.question(question);
  } catch (error) {
    const cancelledError = normalizePromptCancelledError(error, "Launcher config initialization cancelled.");
    if (cancelledError) {
      throw cancelledError;
    }
    throw error;
  } finally {
    readline.close();
  }
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
      setup_command:
        getOptionalString(entry, "setup_command", `project.repos[${index}].setup_command`) ??
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

function getOptionalNumberArray(
  parent: JsonRecord | undefined,
  key: string,
  path: string
): number[] | undefined {
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
