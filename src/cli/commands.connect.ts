import type { CommandResult } from "../types/index.js";
import type { StartupMode } from "../types/index.js";
import { loadConfig, loadConfigWithMetadata, type LoadConfigOptions } from "../config/load.js";
import {
  connectSandbox,
  listSandboxes,
  type LifecycleOperationOptions,
  type ListSandboxesOptions,
  type SandboxHandle,
  type SandboxListItem
} from "../e2b/lifecycle.js";
import { launchMode, resolveStartupMode, type ModeLaunchResult } from "../modes/index.js";
import { loadLastRunState, saveLastRunState, type LastRunState } from "../state/lastRun.js";
import { logger } from "../logging/logger.js";
import { formatSandboxDisplayLabel } from "./sandbox-display-name.js";
import { resolveHostGhToken } from "../auth/gh-host-token.js";
import { withConfiguredTunnel } from "../tunnel/cloudflared.js";
import { formatPromptChoice } from "./prompt-style.js";
import { resolvePromptStartupMode } from "./startup-mode-prompt.js";
import { bootstrapProjectWorkspace, type BootstrapProjectWorkspaceResult } from "../project/bootstrap.js";
import { resolveSandboxCreateEnv, type SandboxCreateEnvResolution } from "../e2b/env.js";
import { loadCliEnvSource } from "./env-source.js";
import {
  addWebServerPasswordForWebMode,
  formatSelectedReposSummary,
  formatSetupOutcomeSummary,
  parseStartupModeValue,
  removeOpenCodeServerPassword,
  resolveWebServerPassword
} from "./command-shared.js";
import { promptWithReadline } from "./readline-prompt.js";

export interface ConnectCommandDeps {
  loadConfig: (options?: LoadConfigOptions) => ReturnType<typeof loadConfig>;
  loadConfigWithMetadata?: (options?: LoadConfigOptions) => ReturnType<typeof loadConfigWithMetadata>;
  connectSandbox: (
    sandboxId: string,
    config: Awaited<ReturnType<typeof loadConfig>>,
    options?: LifecycleOperationOptions
  ) => Promise<SandboxHandle>;
  loadLastRunState: () => Promise<LastRunState | null>;
  listSandboxes: (options?: ListSandboxesOptions) => Promise<SandboxListItem[]>;
  resolvePromptStartupMode: (requestedMode: StartupMode) => Promise<StartupMode>;
  launchMode: (handle: SandboxHandle, mode: StartupMode, options?: { workingDirectory?: string; startupEnv?: Record<string, string> }) => Promise<ModeLaunchResult>;
  resolveEnvSource?: () => Promise<Record<string, string | undefined>>;
  resolveSandboxCreateEnv?: (
    config: Awaited<ReturnType<typeof loadConfig>>,
    envSource?: Record<string, string | undefined>
  ) => SandboxCreateEnvResolution;
  resolveHostGhToken?: (env: NodeJS.ProcessEnv) => Promise<string | undefined>;
  bootstrapProjectWorkspace?: (
    handle: SandboxHandle,
    config: Awaited<ReturnType<typeof loadConfig>>,
    options?: { isConnect?: boolean; runtimeEnv?: Record<string, string>; onProgress?: (message: string) => void }
  ) => Promise<BootstrapProjectWorkspaceResult>;
  saveLastRunState: (state: LastRunState) => Promise<void>;
  isInteractiveTerminal?: () => boolean;
  promptInput?: (question: string) => Promise<string>;
  now: () => string;
}

const defaultDeps: ConnectCommandDeps = {
  loadConfig,
  loadConfigWithMetadata,
  connectSandbox,
  loadLastRunState,
  listSandboxes,
  resolvePromptStartupMode,
  launchMode,
  resolveEnvSource: loadCliEnvSource,
  resolveSandboxCreateEnv,
  saveLastRunState,
  isInteractiveTerminal: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
  promptInput,
  now: () => new Date().toISOString()
};

export interface ConnectCommandOptions {
  skipLastRun?: boolean;
}

export async function runConnectCommand(
  args: string[],
  deps: ConnectCommandDeps = defaultDeps,
  options: ConnectCommandOptions = {}
): Promise<CommandResult> {
  const parsed = parseConnectArgs(args);
  const loadedConfig = deps.loadConfigWithMetadata ? await deps.loadConfigWithMetadata() : undefined;
  const config = loadedConfig ? loadedConfig.config : await deps.loadConfig();
  if (loadedConfig) {
    logger.info(`Using launcher config: ${loadedConfig.configPath}`);
  }

  return withConfiguredTunnel(config, async (tunnelRuntimeEnv) => {
    const target = await resolveSandboxTarget(parsed.sandboxId, deps, options);
    const targetLabel = target.label ?? target.sandboxId;
    const requestedMode = parsed.mode ?? config.startup.mode;
    logger.verbose(`Resolving startup mode from '${requestedMode}'.`);
    const mode = await deps.resolvePromptStartupMode(requestedMode);
    const resolvedMode = resolveStartupMode(mode);
    if (requestedMode === "prompt") {
      logger.verbose(`Startup mode selected via prompt: ${mode}.`);
    }

    logger.verbose(`Connecting to sandbox ${targetLabel}.`);
    const handle = await deps.connectSandbox(target.sandboxId, config);
    logger.verbose(`Connected to sandbox ${targetLabel}.`);

    await deps.saveLastRunState({
      sandboxId: handle.sandboxId,
      mode,
      activeRepo: undefined,
      updatedAt: deps.now()
    });

    const envSource = deps.resolveEnvSource ? await deps.resolveEnvSource() : await loadCliEnvSource();
    const envResolution = deps.resolveSandboxCreateEnv
      ? deps.resolveSandboxCreateEnv(config, envSource)
      : {
          envs: {}
        };
    const ghRuntimeEnv = await resolveGhRuntimeEnv(config, envSource, deps.resolveHostGhToken);
    const runtimeEnv = removeOpenCodeServerPassword({
      ...envResolution.envs,
      ...tunnelRuntimeEnv,
      ...ghRuntimeEnv
    });
    const webServerPassword = resolveWebServerPassword(envSource);
    const preferredActiveRepo = await resolvePreferredActiveRepo(config, target.sandboxId, deps, options);

    try {
      const bootstrapResult = await (deps.bootstrapProjectWorkspace ?? bootstrapProjectWorkspace)(handle, config, {
        isConnect: true,
        preferredActiveRepo,
        runtimeEnv,
        onProgress: (message) => logger.verbose(`Bootstrap: ${message}`)
      });
      logger.verbose(`Selected repos summary: ${formatSelectedReposSummary(bootstrapResult.selectedRepoNames)}.`);
      logger.verbose(`Setup outcome summary: ${formatSetupOutcomeSummary(bootstrapResult.setup)}.`);

      logger.verbose(`Launching startup mode '${mode}'.`);
      const launched = await deps.launchMode(handle, mode, {
        workingDirectory: bootstrapResult.workingDirectory,
        startupEnv: addWebServerPasswordForWebMode(
          {
            ...bootstrapResult.startupEnv,
            ...runtimeEnv
          },
          resolvedMode,
          webServerPassword
        )
      });

      const activeRepo = bootstrapResult.selectedRepoNames.length === 1 ? bootstrapResult.selectedRepoNames[0] : undefined;

      await deps.saveLastRunState({
        sandboxId: handle.sandboxId,
        mode: launched.mode,
        activeRepo,
        updatedAt: deps.now()
      });

      if (parsed.json) {
        return {
          message: JSON.stringify(
            {
              sandboxId: handle.sandboxId,
              sandboxLabel: targetLabel,
              mode: launched.mode,
              command: launched.command,
              url: launched.url,
              workingDirectory: bootstrapResult.workingDirectory,
              activeRepo,
              setup: bootstrapResult.setup
            },
            null,
            2
          ),
          exitCode: 0
        };
      }

      return {
        message: `Connected to sandbox ${targetLabel}. ${launched.message}`,
        exitCode: 0
      };
    } catch (error) {
      throw error;
    }
  });
}

async function resolveGhRuntimeEnv(
  config: Awaited<ReturnType<typeof loadConfig>>,
  envSource: Record<string, string | undefined>,
  resolveToken?: (env: NodeJS.ProcessEnv) => Promise<string | undefined>
): Promise<Record<string, string>> {
  if (!config.gh.enabled) {
    return {};
  }

  logger.verbose("GitHub auth: resolving token.");
  const resolver = resolveToken ?? resolveHostGhToken;
  const token = await resolver(envSource);
  if (!token) {
    logger.verbose("GitHub auth: token not found; continuing without GH_TOKEN/GITHUB_TOKEN.");
    return {};
  }

  logger.verbose("GitHub auth: token found; injecting GH_TOKEN/GITHUB_TOKEN.");
  return {
    GH_TOKEN: token,
    GITHUB_TOKEN: token
  };
}

async function resolvePreferredActiveRepo(
  config: Awaited<ReturnType<typeof loadConfig>>,
  targetSandboxId: string,
  deps: ConnectCommandDeps,
  options: ConnectCommandOptions
): Promise<string | undefined> {
  if (options.skipLastRun) {
    return undefined;
  }

  if (config.project.mode !== "single" || config.project.active !== "prompt" || config.project.repos.length <= 1) {
    return undefined;
  }

  const lastRun = await deps.loadLastRunState();
  if (!lastRun || lastRun.sandboxId !== targetSandboxId) {
    return undefined;
  }

  const preferred = lastRun.activeRepo?.trim();
  return preferred ? preferred : undefined;
}

async function resolveSandboxTarget(
  sandboxIdArg: string | undefined,
  deps: ConnectCommandDeps,
  options: ConnectCommandOptions
): Promise<{ sandboxId: string; label?: string }> {
  if (sandboxIdArg) {
    return { sandboxId: sandboxIdArg };
  }

  const sandboxes = await deps.listSandboxes();
  const firstSandbox = sandboxes[0];
  if (!firstSandbox) {
    throw new Error("No sandboxes are available to connect.");
  }

  if (sandboxes.length === 1) {
    const fallbackLabel = formatSandboxDisplayLabel(firstSandbox.sandboxId, firstSandbox.metadata);
    if (fallbackLabel !== firstSandbox.sandboxId) {
      logger.verbose(`Selected fallback sandbox: ${fallbackLabel}.`);
    }

    return {
      sandboxId: firstSandbox.sandboxId,
      label: fallbackLabel === firstSandbox.sandboxId ? undefined : fallbackLabel
    };
  }

  const isInteractiveTerminal = deps.isInteractiveTerminal ?? (() => Boolean(process.stdin.isTTY && process.stdout.isTTY));
  if (isInteractiveTerminal()) {
    return promptForSandboxTargetSelection(sandboxes, deps);
  }

  if (!options.skipLastRun) {
    const lastRun = await deps.loadLastRunState();
    const matchedSandbox =
      lastRun?.sandboxId === undefined ? undefined : sandboxes.find((sandbox) => sandbox.sandboxId === lastRun.sandboxId);
    if (matchedSandbox) {
      const fallbackLabel = formatSandboxDisplayLabel(matchedSandbox.sandboxId, matchedSandbox.metadata);
      if (fallbackLabel !== matchedSandbox.sandboxId) {
        logger.verbose(`Selected fallback sandbox: ${fallbackLabel}.`);
      }

      return {
        sandboxId: matchedSandbox.sandboxId,
        label: fallbackLabel === matchedSandbox.sandboxId ? undefined : fallbackLabel
      };
    }
  }

  throw new Error(
    "Multiple sandboxes are available but no interactive terminal was detected. Re-run with --sandbox-id <sandbox-id>."
  );
}

async function promptForSandboxTargetSelection(
  sandboxes: SandboxListItem[],
  deps: ConnectCommandDeps
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

async function promptInput(question: string): Promise<string> {
  return promptWithReadline(question);
}

function parseConnectArgs(args: string[]): { sandboxId?: string; mode?: StartupMode; json: boolean } {
  let sandboxId: string | undefined;
  let mode: StartupMode | undefined;
  let json = false;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (token === "--sandbox-id") {
      const next = args[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("Missing value for --sandbox-id.");
      }
      sandboxId = next;
      index += 1;
      continue;
    }

    if (token === "--mode") {
      const next = args[index + 1];
      mode = parseStartupModeValue(next);
      index += 1;
      continue;
    }

    if (token === "--json") {
      json = true;
      continue;
    }

    if (token.startsWith("--")) {
      throw new Error(`Unknown option for connect: '${token}'. Use --help for usage.`);
    }
    throw new Error(`Unexpected positional argument for connect: '${token}'. Use --help for usage.`);
  }

  return { sandboxId, mode, json };
}
