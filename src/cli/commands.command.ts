import { posix } from "node:path";
import { createInterface } from "node:readline/promises";
import { loadConfig, loadConfigWithMetadata, type LoadConfigOptions } from "../config/load.js";
import { connectSandbox, listSandboxes, type LifecycleOperationOptions, type ListSandboxesOptions, type SandboxHandle, type SandboxListItem } from "../e2b/lifecycle.js";
import { resolveSandboxCreateEnv, type SandboxCreateEnvResolution } from "../e2b/env.js";
import { loadLastRunState, type LastRunState } from "../state/lastRun.js";
import type { CommandResult } from "../types/index.js";
import { formatSandboxDisplayLabel } from "./sandbox-display-name.js";
import { withConfiguredTunnel } from "../tunnel/cloudflared.js";
import { formatPromptChoice } from "./prompt-style.js";
import { loadCliEnvSource } from "./env-source.js";
import { logger } from "../logging/logger.js";

const OPENCODE_SERVER_PASSWORD_ENV_VAR = "OPENCODE_SERVER_PASSWORD";

export interface CommandCommandDeps {
  loadConfig: (options?: LoadConfigOptions) => ReturnType<typeof loadConfig>;
  loadConfigWithMetadata?: (options?: LoadConfigOptions) => ReturnType<typeof loadConfigWithMetadata>;
  listSandboxes: (options?: ListSandboxesOptions) => Promise<SandboxListItem[]>;
  connectSandbox: (
    sandboxId: string,
    config: Awaited<ReturnType<typeof loadConfig>>,
    options?: LifecycleOperationOptions
  ) => Promise<SandboxHandle>;
  resolveEnvSource?: () => Promise<Record<string, string | undefined>>;
  resolveSandboxCreateEnv?: (
    config: Awaited<ReturnType<typeof loadConfig>>,
    envSource?: Record<string, string | undefined>
  ) => SandboxCreateEnvResolution;
  loadLastRunState: () => Promise<LastRunState | null>;
  isInteractiveTerminal?: () => boolean;
  promptInput?: (question: string) => Promise<string>;
}

const defaultDeps: CommandCommandDeps = {
  loadConfig,
  loadConfigWithMetadata,
  listSandboxes,
  connectSandbox,
  resolveEnvSource: loadCliEnvSource,
  resolveSandboxCreateEnv,
  loadLastRunState,
  isInteractiveTerminal: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
  promptInput
};

export async function runCommandCommand(args: string[], deps: CommandCommandDeps = defaultDeps): Promise<CommandResult> {
  const parsed = parseCommandArgs(args);
  const loadedConfig = deps.loadConfigWithMetadata ? await deps.loadConfigWithMetadata() : undefined;
  const config = loadedConfig ? loadedConfig.config : await deps.loadConfig();
  if (loadedConfig) {
    logger.info(`Using launcher config: ${loadedConfig.configPath}`);
  }
  return withConfiguredTunnel(config, async (tunnelRuntimeEnv) => {
    const sandboxTarget = await resolveSandboxTarget(parsed.sandboxId, deps);
    const selectedRepos = await resolveSelectedRepos(config.project.repos, config.project.mode, config.project.active, deps);
    const cwd = resolveCommandWorkingDirectory(config.project.dir, selectedRepos);
    const envSource = deps.resolveEnvSource ? await deps.resolveEnvSource() : {};
    const envResolution = deps.resolveSandboxCreateEnv
      ? deps.resolveSandboxCreateEnv(config, envSource)
      : {
          envs: {}
        };
    const runtimeEnv = withoutOpenCodeServerPassword({
      ...envResolution.envs,
      ...tunnelRuntimeEnv
    });

    const handle = await deps.connectSandbox(sandboxTarget.sandboxId, config);
    const result = await handle.run(parsed.command, {
      cwd,
      ...(Object.keys(runtimeEnv).length > 0 ? { envs: runtimeEnv } : {})
    });
    const stdout = result.stdout.trim() === "" ? "(empty)" : result.stdout;
    const stderr = result.stderr.trim() === "" ? "(empty)" : result.stderr;
    const sandboxLabel = sandboxTarget.label ?? sandboxTarget.sandboxId;

    return {
      message: [
        `Ran command in sandbox ${sandboxLabel}.`,
        `cwd: ${cwd}`,
        "",
        "stdout:",
        stdout,
        "",
        "stderr:",
        stderr
      ].join("\n"),
      exitCode: result.exitCode
    };
  });
}

function withoutOpenCodeServerPassword(envs: Record<string, string>): Record<string, string> {
  const { [OPENCODE_SERVER_PASSWORD_ENV_VAR]: _ignored, ...rest } = envs;
  return rest;
}

function parseCommandArgs(args: string[]): { sandboxId?: string; command: string } {
  let sandboxId: string | undefined;
  let commandStartIndex = args.length;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (token === "--") {
      commandStartIndex = index + 1;
      break;
    }

    if (token === "--sandbox-id") {
      const next = args[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("Missing value for --sandbox-id.");
      }
      sandboxId = next;
      index += 1;
      continue;
    }

    commandStartIndex = index;
    break;
  }

  const commandTokens = args.slice(commandStartIndex);
  if (commandTokens.length === 0) {
    throw new Error("Missing remote command. Provide a command after options (use -- when needed).");
  }

  return {
    sandboxId,
    command: commandTokens.join(" ")
  };
}

async function resolveSandboxTarget(
  sandboxIdArg: string | undefined,
  deps: CommandCommandDeps
): Promise<{ sandboxId: string; label?: string }> {
  if (sandboxIdArg) {
    return { sandboxId: sandboxIdArg };
  }

  const sandboxes = await deps.listSandboxes();
  const firstSandbox = sandboxes[0];
  if (!firstSandbox) {
    throw new Error("No sandboxes are available. Create one with 'ez-devbox create' or pass --sandbox-id <sandbox-id>.");
  }

  if (sandboxes.length === 1) {
    const label = formatSandboxDisplayLabel(firstSandbox.sandboxId, firstSandbox.metadata);
    return {
      sandboxId: firstSandbox.sandboxId,
      label: label === firstSandbox.sandboxId ? undefined : label
    };
  }

  const isInteractiveTerminal = deps.isInteractiveTerminal ?? (() => Boolean(process.stdin.isTTY && process.stdout.isTTY));
  if (isInteractiveTerminal()) {
    return promptForSandboxSelection(sandboxes, deps);
  }

  const lastRun = await deps.loadLastRunState();
  const matched =
    lastRun?.sandboxId === undefined ? undefined : sandboxes.find((sandbox) => sandbox.sandboxId === lastRun.sandboxId);
  if (matched) {
    const label = formatSandboxDisplayLabel(matched.sandboxId, matched.metadata);
    return {
      sandboxId: matched.sandboxId,
      label: label === matched.sandboxId ? undefined : label
    };
  }

  throw new Error(
    "Multiple sandboxes are available but no interactive terminal was detected. Re-run with --sandbox-id <sandbox-id>."
  );
}

async function promptForSandboxSelection(
  sandboxes: SandboxListItem[],
  deps: CommandCommandDeps
): Promise<{ sandboxId: string; label?: string }> {
  const prompt = deps.promptInput ?? promptInput;
  const options = sandboxes.map((sandbox, index) => {
    const label = formatSandboxDisplayLabel(sandbox.sandboxId, sandbox.metadata);
    return {
      index: index + 1,
      sandboxId: sandbox.sandboxId,
      label
    };
  });

  const question = [
    "Multiple sandboxes available. Select one:",
    ...options.map((option) => formatPromptChoice(option.index, option.label)),
    `Enter choice [1-${options.length}]: `
  ].join("\n");
  const selectedIndex = Number.parseInt((await prompt(question)).trim(), 10);
  const selected = Number.isNaN(selectedIndex) ? undefined : options[selectedIndex - 1];
  if (!selected) {
    throw new Error(
      `Invalid sandbox selection. Enter a number between 1 and ${options.length}, or use --sandbox-id <sandbox-id>.`
    );
  }

  return {
    sandboxId: selected.sandboxId,
    label: selected.label === selected.sandboxId ? undefined : selected.label
  };
}

async function resolveSelectedRepos(
  repos: Awaited<ReturnType<typeof loadConfig>>["project"]["repos"],
  mode: Awaited<ReturnType<typeof loadConfig>>["project"]["mode"],
  active: Awaited<ReturnType<typeof loadConfig>>["project"]["active"],
  deps: CommandCommandDeps
): Promise<Awaited<ReturnType<typeof loadConfig>>["project"]["repos"]> {
  if (repos.length === 0) {
    return [];
  }

  if (mode === "all") {
    return [...repos];
  }

  if (repos.length === 1) {
    return [repos[0]];
  }

  const isInteractiveTerminal = deps.isInteractiveTerminal ?? (() => Boolean(process.stdin.isTTY && process.stdout.isTTY));
  if (active === "prompt" && isInteractiveTerminal()) {
    const prompt = deps.promptInput ?? promptInput;
    const question = [
      "Multiple repos available. Select one:",
      ...repos.map((repo, index) => formatPromptChoice(index + 1, repo.name)),
      `Enter choice [1-${repos.length}]: `
    ].join("\n");
    const selectedIndex = Number.parseInt((await prompt(question)).trim(), 10);
    const selected = Number.isNaN(selectedIndex) ? undefined : repos[selectedIndex - 1];
    if (!selected) {
      throw new Error(`Invalid repo selection. Enter a number between 1 and ${repos.length}.`);
    }
    return [selected];
  }

  return [repos[0]];
}

function resolveCommandWorkingDirectory(
  projectDir: string,
  selectedRepos: Awaited<ReturnType<typeof loadConfig>>["project"]["repos"]
): string {
  if (selectedRepos.length === 1) {
    return posix.join(projectDir, selectedRepos[0].name);
  }

  return projectDir;
}

async function promptInput(question: string): Promise<string> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    return await readline.question(question);
  } finally {
    readline.close();
  }
}
