import { type LoadConfigOptions, loadConfig, loadConfigWithMetadata } from "../config/load.js";
import { resolveSandboxCreateEnv, type SandboxCreateEnvResolution } from "../e2b/env.js";
import { type CreateSandboxOptions, createSandbox, type SandboxHandle } from "../e2b/lifecycle.js";
import { logger } from "../logging/logger.js";
import { type ConcreteStartupMode, launchMode, type ModeLaunchResult, resolveStartupMode } from "../modes/index.js";
import { type BootstrapProjectWorkspaceResult, bootstrapProjectWorkspace } from "../project/bootstrap.js";
import { type LastRunState, saveLastRunState } from "../state/lastRun.js";
import type { ToolingSyncSummary } from "../tooling/host-sandbox-sync.js";
import { type WithConfiguredTunnel, withConfiguredTunnel } from "../tunnel/cloudflared.js";
import type { CommandResult, StartupMode } from "../types/index.js";
import {
  addWebServerPasswordForWebMode,
  formatSelectedReposSummary,
  formatSetupOutcomeSummary,
  removeOpenCodeServerPassword,
  resolveWebServerPassword,
} from "./command-shared.js";
import { parseCreateArgs } from "./commands.create.args.js";
import { formatEnvVarNames, hasPublicTunnelRuntimeEnv, resolveGhRuntimeEnv } from "./commands.create.env.js";
import { formatToolingSyncSummary, syncToolingForMode } from "./commands.create.sync.js";
import { resolveTemplateForMode } from "./commands.create.template.js";
import { loadCliEnvSource } from "./env-source.js";
import { isPromptCancelledError, PromptCancelledError } from "./prompt-cancelled.js";
import { buildSandboxDisplayName, formatSandboxDisplayLabel } from "./sandbox-display-name.js";
import { resolvePromptStartupMode } from "./startup-mode-prompt.js";

export interface CreateCommandDeps {
  loadConfig: (options?: LoadConfigOptions) => ReturnType<typeof loadConfig>;
  loadConfigWithMetadata?: (options?: LoadConfigOptions) => ReturnType<typeof loadConfigWithMetadata>;
  createSandbox: (
    config: Awaited<ReturnType<typeof loadConfig>>,
    options?: CreateSandboxOptions,
  ) => Promise<SandboxHandle>;
  resolveEnvSource: () => Promise<Record<string, string | undefined>>;
  resolveSandboxCreateEnv: (
    config: Awaited<ReturnType<typeof loadConfig>>,
    envSource?: Record<string, string | undefined>,
  ) => SandboxCreateEnvResolution;
  resolveHostGhToken?: (env: NodeJS.ProcessEnv) => Promise<string | undefined>;
  resolvePromptStartupMode: (requestedMode: StartupMode) => Promise<StartupMode>;
  launchMode: (
    handle: SandboxHandle,
    mode: StartupMode,
    options?: { workingDirectory?: string; startupEnv?: Record<string, string> },
  ) => Promise<ModeLaunchResult>;
  bootstrapProjectWorkspace?: (
    handle: SandboxHandle,
    config: Awaited<ReturnType<typeof loadConfig>>,
    options?: { isConnect?: boolean; runtimeEnv?: Record<string, string>; onProgress?: (message: string) => void },
  ) => Promise<BootstrapProjectWorkspaceResult>;
  syncToolingToSandbox: (
    config: Awaited<ReturnType<typeof loadConfig>>,
    sandbox: Pick<SandboxHandle, "writeFile">,
    mode: ConcreteStartupMode,
  ) => Promise<ToolingSyncSummary>;
  saveLastRunState: (state: LastRunState) => Promise<void>;
  now: () => string;
  withConfiguredTunnel?: WithConfiguredTunnel;
}

const defaultDeps: CreateCommandDeps = {
  loadConfig,
  loadConfigWithMetadata,
  createSandbox,
  resolveEnvSource: loadCliEnvSource,
  resolveSandboxCreateEnv,
  resolvePromptStartupMode,
  launchMode,
  syncToolingToSandbox: syncToolingForMode,
  saveLastRunState,
  now: () => new Date().toISOString(),
};

export async function runCreateCommand(args: string[], deps: CreateCommandDeps = defaultDeps): Promise<CommandResult> {
  const parsed = parseCreateArgs(args);
  const loadedConfig = deps.loadConfigWithMetadata ? await deps.loadConfigWithMetadata() : undefined;
  const config = loadedConfig ? loadedConfig.config : await deps.loadConfig();
  if (loadedConfig) {
    logger.info(`Using launcher config: ${loadedConfig.configPath}`);
  }
  const runWithTunnel = deps.withConfiguredTunnel ?? withConfiguredTunnel;
  return runWithTunnel(config, async (tunnelRuntimeEnv) => {
    if (hasPublicTunnelRuntimeEnv(tunnelRuntimeEnv)) {
      logger.warn(
        "Tunnel URL warning: anyone with the URL can access the forwarded service/data. Treat tunnel URLs as secrets.",
      );
    }

    const requestedMode = parsed.mode ?? config.startup.mode;
    logger.verbose(`Resolving startup mode from '${requestedMode}'.`);
    const mode = await deps.resolvePromptStartupMode(requestedMode);
    if (requestedMode === "prompt") {
      logger.verbose(`Startup mode selected via prompt: ${mode}.`);
    }
    const resolvedMode = resolveStartupMode(mode);
    const displayName = buildSandboxDisplayName(config.project.repos, deps.now());
    const templateResolution = resolveTemplateForMode(config.sandbox.template, resolvedMode);
    const createConfig =
      templateResolution.template === config.sandbox.template
        ? config
        : {
            ...config,
            sandbox: {
              ...config.sandbox,
              template: templateResolution.template,
            },
          };
    const envSource = await deps.resolveEnvSource();
    const envResolution = deps.resolveSandboxCreateEnv(config, envSource);
    const ghRuntimeEnv = await resolveGhRuntimeEnv(config, envSource, deps.resolveHostGhToken);
    const runtimeEnv = removeOpenCodeServerPassword({
      ...envResolution.envs,
      ...tunnelRuntimeEnv,
      ...ghRuntimeEnv,
    });
    const webServerPassword = resolveWebServerPassword(envSource);
    const createEnvs = { ...runtimeEnv };
    logger.verbose(`Creating sandbox with envs: ${formatEnvVarNames(createEnvs)}`);

    logger.verbose(`Creating sandbox '${displayName}' with template '${createConfig.sandbox.template}'.`);
    const handle = await deps.createSandbox(createConfig, {
      envs: createEnvs,
      metadata: {
        "launcher.name": displayName,
      },
    });
    const sandboxLabel = formatSandboxDisplayLabel(handle.sandboxId, { "launcher.name": displayName });
    logger.verbose(`Sandbox ready: ${sandboxLabel}.`);

    let stopLoading: (() => void) | undefined;
    const stopLoadingIfRunning = (): void => {
      stopLoading?.();
      stopLoading = undefined;
    };
    const ensureLoading = (): void => {
      if (!stopLoading) {
        stopLoading = logger.startLoading("Bootstrapping...");
      }
    };
    try {
      await deps.saveLastRunState({
        sandboxId: handle.sandboxId,
        mode,
        activeRepo: undefined,
        updatedAt: deps.now(),
      });

      logger.verbose("Syncing local tooling config/auth.");
      const syncSummary = await deps.syncToolingToSandbox(config, handle, resolvedMode);

      const bootstrapResult = await (deps.bootstrapProjectWorkspace ?? bootstrapProjectWorkspace)(handle, config, {
        isConnect: false,
        runtimeEnv,
        onProgress: (message) => {
          ensureLoading();
          logger.verbose(`Bootstrap: ${message}`);
        },
      });
      stopLoadingIfRunning();
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

      const templateSuffix = templateResolution.autoSelected
        ? `\nTemplate auto-selected for ${resolvedMode}: ${templateResolution.template}`
        : "";
      const syncSuffix = `\nTooling sync: ${formatToolingSyncSummary(syncSummary)}`;

      if (parsed.json) {
        return {
          message: JSON.stringify(
            {
              sandboxId: handle.sandboxId,
              sandboxLabel,
              mode: launched.mode,
              command: launched.command,
              url: launched.url,
              workingDirectory: bootstrapResult.workingDirectory,
              activeRepo,
              template: createConfig.sandbox.template,
              setup: bootstrapResult.setup,
              toolingSync: syncSummary,
            },
            null,
            2,
          ),
          exitCode: 0,
        };
      }

      return {
        message: `Created sandbox ${sandboxLabel}. ${launched.message}${templateSuffix}${syncSuffix}`,
        exitCode: 0,
      };
    } catch (error) {
      if (!isPromptCancelledError(error)) {
        throw error;
      }

      logger.verbose("Setup selection cancelled; wiping newly created sandbox.");
      try {
        await handle.kill();
      } catch (wipeError) {
        throw new PromptCancelledError(
          `Setup selection cancelled and sandbox '${sandboxLabel}' could not be wiped: ${toErrorMessage(wipeError)}`,
          { cause: error },
        );
      }

      throw new PromptCancelledError(`Setup selection cancelled; sandbox '${sandboxLabel}' was wiped.`, {
        cause: error,
      });
    } finally {
      stopLoadingIfRunning();
    }
  });
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }
  return "unknown error";
}
export { syncToolingForMode };
