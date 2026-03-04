import { type LoadConfigOptions, loadConfig, loadConfigWithMetadata } from "../config/load.js";
import { resolveSandboxCreateEnv, type SandboxCreateEnvResolution } from "../e2b/env.js";
import {
  connectSandbox,
  type LifecycleOperationOptions,
  type ListSandboxesOptions,
  listSandboxes,
  type SandboxHandle,
  type SandboxListItem,
} from "../e2b/lifecycle.js";
import { logger } from "../logging/logger.js";
import { launchMode, type ModeLaunchResult, resolveStartupMode } from "../modes/index.js";
import { type BootstrapProjectWorkspaceResult, bootstrapProjectWorkspace } from "../project/bootstrap.js";
import { type LastRunState, loadLastRunState, saveLastRunState } from "../state/lastRun.js";
import { withConfiguredTunnel } from "../tunnel/cloudflared.js";
import type { CommandResult, StartupMode } from "../types/index.js";
import {
  addWebServerPasswordForWebMode,
  formatSelectedReposSummary,
  formatSetupOutcomeSummary,
  removeOpenCodeServerPassword,
  resolveWebServerPassword,
} from "./command-shared.js";
import { parseConnectArgs } from "./commands.connect.args.js";
import { resolveGhRuntimeEnv } from "./commands.connect.env.js";
import { resolvePreferredActiveRepo, resolveSandboxTarget } from "./commands.connect.target.js";
import { loadCliEnvSource } from "./env-source.js";
import { resolvePromptStartupMode } from "./startup-mode-prompt.js";

export interface ConnectCommandDeps {
  loadConfig: (options?: LoadConfigOptions) => ReturnType<typeof loadConfig>;
  loadConfigWithMetadata?: (options?: LoadConfigOptions) => ReturnType<typeof loadConfigWithMetadata>;
  connectSandbox: (
    sandboxId: string,
    config: Awaited<ReturnType<typeof loadConfig>>,
    options?: LifecycleOperationOptions,
  ) => Promise<SandboxHandle>;
  loadLastRunState: () => Promise<LastRunState | null>;
  listSandboxes: (options?: ListSandboxesOptions) => Promise<SandboxListItem[]>;
  resolvePromptStartupMode: (requestedMode: StartupMode) => Promise<StartupMode>;
  launchMode: (
    handle: SandboxHandle,
    mode: StartupMode,
    options?: { workingDirectory?: string; startupEnv?: Record<string, string> },
  ) => Promise<ModeLaunchResult>;
  resolveEnvSource?: () => Promise<Record<string, string | undefined>>;
  resolveSandboxCreateEnv?: (
    config: Awaited<ReturnType<typeof loadConfig>>,
    envSource?: Record<string, string | undefined>,
  ) => SandboxCreateEnvResolution;
  resolveHostGhToken?: (env: NodeJS.ProcessEnv) => Promise<string | undefined>;
  bootstrapProjectWorkspace?: (
    handle: SandboxHandle,
    config: Awaited<ReturnType<typeof loadConfig>>,
    options?: { isConnect?: boolean; runtimeEnv?: Record<string, string>; onProgress?: (message: string) => void },
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
  now: () => new Date().toISOString(),
};

export interface ConnectCommandOptions {
  skipLastRun?: boolean;
}

export async function runConnectCommand(
  args: string[],
  deps: ConnectCommandDeps = defaultDeps,
  options: ConnectCommandOptions = {},
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
      updatedAt: deps.now(),
    });

    const envSource = deps.resolveEnvSource ? await deps.resolveEnvSource() : await loadCliEnvSource();
    const envResolution = deps.resolveSandboxCreateEnv
      ? deps.resolveSandboxCreateEnv(config, envSource)
      : {
          envs: {},
        };
    const ghRuntimeEnv = await resolveGhRuntimeEnv(config, envSource, deps.resolveHostGhToken);
    const runtimeEnv = removeOpenCodeServerPassword({
      ...envResolution.envs,
      ...tunnelRuntimeEnv,
      ...ghRuntimeEnv,
    });
    const webServerPassword = resolveWebServerPassword(envSource);
    const preferredActiveRepo = await resolvePreferredActiveRepo(config, target.sandboxId, deps, options);

    const bootstrapResult = await (deps.bootstrapProjectWorkspace ?? bootstrapProjectWorkspace)(handle, config, {
      isConnect: true,
      preferredActiveRepo,
      runtimeEnv,
      onProgress: (message) => logger.verbose(`Bootstrap: ${message}`),
    });
    logger.verbose(`Selected repos summary: ${formatSelectedReposSummary(bootstrapResult.selectedRepoNames)}.`);
    logger.verbose(`Setup outcome summary: ${formatSetupOutcomeSummary(bootstrapResult.setup)}.`);

    logger.verbose(`Launching startup mode '${mode}'.`);
    const launched = await deps.launchMode(handle, mode, {
      workingDirectory: bootstrapResult.workingDirectory,
      startupEnv: addWebServerPasswordForWebMode(
        {
          ...bootstrapResult.startupEnv,
          ...runtimeEnv,
        },
        resolvedMode,
        webServerPassword,
      ),
    });

    const activeRepo =
      bootstrapResult.selectedRepoNames.length === 1 ? bootstrapResult.selectedRepoNames[0] : undefined;

    await deps.saveLastRunState({
      sandboxId: handle.sandboxId,
      mode: launched.mode,
      activeRepo,
      updatedAt: deps.now(),
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
            setup: bootstrapResult.setup,
          },
          null,
          2,
        ),
        exitCode: 0,
      };
    }

    return {
      message: `Connected to sandbox ${targetLabel}. ${launched.message}`,
      exitCode: 0,
    };
  });
}
