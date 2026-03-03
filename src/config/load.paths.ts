import { access, mkdir, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { normalizePromptCancelledError } from "../cli/prompt-cancelled.js";
import type { LoadedLauncherConfig, LoadConfigOptions } from "./load.types.js";

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

export async function resolveLauncherConfigPath(
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

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}
