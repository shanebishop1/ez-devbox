import { type LoadConfigOptions, loadConfig, loadConfigWithMetadata } from "../config/load.js";
import type { ResolvedProjectRepoConfig } from "../config/schema.js";
import { resolveSandboxCreateEnv, type SandboxCreateEnvResolution } from "../e2b/env.js";
import { type CreateSandboxOptions, createSandbox, type SandboxHandle } from "../e2b/lifecycle.js";
import { isVerboseLoggingEnabled, logger } from "../logging/logger.js";
import { type ConcreteStartupMode, launchMode, type ModeLaunchResult, resolveStartupMode } from "../modes/index.js";
import { type BootstrapProjectWorkspaceResult, bootstrapProjectWorkspace } from "../project/bootstrap.js";
import { type SelectReposOptions, selectRepos } from "../project/bootstrap.repo-selection.js";
import { type LastRunState, saveLastRunState } from "../state/lastRun.js";
import type { ToolingSyncSummary } from "../tooling/host-sandbox-sync.js";
import { type WithConfiguredTunnel, withConfiguredTunnel } from "../tunnel/cloudflared.js";
import { resolveTunnelPorts } from "../tunnel/cloudflared.spawn.js";
import type { CommandResult, StartupMode } from "../types/index.js";
import {
  addWebServerPasswordForWebMode,
  formatSelectedReposSummary,
  formatSetupOutcomeSummary,
  removeOpenCodeServerPassword,
  resolveWebServerPassword,
} from "./command-shared.js";
import { parseCreateArgs } from "./commands.create.args.js";
import { formatEnvVarNames, resolveGhRuntimeEnv } from "./commands.create.env.js";
import { formatToolingSyncSummary, syncToolingForMode } from "./commands.create.sync.js";
import { resolveTemplateForMode } from "./commands.create.template.js";
import { loadCliEnvSource } from "./env-source.js";
import { isPromptCancelledError, PromptCancelledError } from "./prompt-cancelled.js";
import { formatPromptLogTag, renderPromptWizardHeader, SSH_SUSPEND_RESUME_HINT } from "./prompt-style.js";
import { buildSandboxDisplayName, formatSandboxDisplayLabel } from "./sandbox-display-name.js";
import {
  resolvePromptStartupMode,
  type StartupModePromptDeps,
  type StartupModePromptOptions,
} from "./startup-mode-prompt.js";

const TUNNEL_URL_WARNING_MESSAGE =
  "Anyone with access to your Tunnel URL can access the forwarded service/data. Treat tunnel URLs as secrets.";
const ANSI_GREEN = "\u001b[32m";
const ANSI_RESET = "\u001b[0m";

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
  resolvePromptStartupMode: (
    requestedMode: StartupMode,
    deps?: StartupModePromptDeps,
    options?: StartupModePromptOptions,
  ) => Promise<StartupMode>;
  selectReposForCreate?: (
    repos: ResolvedProjectRepoConfig[],
    mode: "single" | "all",
    active: "prompt" | "name" | "index",
    options: SelectReposOptions,
  ) => Promise<ResolvedProjectRepoConfig[]>;
  isInteractiveTerminal?: () => boolean;
  promptInput?: (question: string) => Promise<string>;
  launchMode: (
    handle: SandboxHandle,
    mode: StartupMode,
    options?: {
      workingDirectory?: string;
      startupEnv?: Record<string, string>;
      onBeforeInteractiveSession?: () => void;
      onLaunchStageUpdate?: (loadingMessage: string, completionMessage: string) => void;
      matchLocalOpenCodeVersion?: boolean;
    },
  ) => Promise<ModeLaunchResult>;
  bootstrapProjectWorkspace?: (
    handle: SandboxHandle,
    config: Awaited<ReturnType<typeof loadConfig>>,
    options?: {
      isConnect?: boolean;
      runtimeEnv?: Record<string, string>;
      onProgress?: (message: string) => void;
      selectedReposOverride?: ResolvedProjectRepoConfig[];
    },
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
  const requestedMode = parsed.mode ?? config.startup.mode;
  const isInteractiveTerminal =
    deps.isInteractiveTerminal ?? (() => Boolean(process.stdin.isTTY && process.stdout.isTTY));
  const showsRepoPromptInCurrentSession =
    isInteractiveTerminal() &&
    config.project.mode === "single" &&
    config.project.active === "prompt" &&
    config.project.repos.length > 1;
  const tunnelConfigured = resolveTunnelPorts(config.tunnel.ports, config.tunnel.targets).length > 0;
  const showsPromptInCurrentSession = requestedMode === "prompt" && isInteractiveTerminal();
  const promptPrefaceLines: string[] = [];
  if (isInteractiveTerminal() && !parsed.json) {
    promptPrefaceLines.push(`${formatPromptLogTag("info")} ${SSH_SUSPEND_RESUME_HINT}`);
  }
  if (loadedConfig) {
    promptPrefaceLines.push(`${formatPromptLogTag("info")} Using launcher config: ${loadedConfig.configPath}`);
  }
  if (tunnelConfigured) {
    promptPrefaceLines.push(`${formatPromptLogTag("warn")} ${TUNNEL_URL_WARNING_MESSAGE}`);
  }
  const promptOptions =
    showsPromptInCurrentSession && promptPrefaceLines.length > 0
      ? {
          prefaceLines: promptPrefaceLines,
        }
      : undefined;

  if (isInteractiveTerminal() && !showsPromptInCurrentSession) {
    process.stdout.write(`${renderPromptWizardHeader("ez-devbox")}\n\n`);
  }

  if (!showsPromptInCurrentSession) {
    if (isInteractiveTerminal() && !parsed.json) {
      logger.info(SSH_SUSPEND_RESUME_HINT);
    }
    if (loadedConfig) {
      logger.info(`Using launcher config: ${loadedConfig.configPath}`);
    }
    if (tunnelConfigured) {
      logger.warn(TUNNEL_URL_WARNING_MESSAGE);
    }
    if (showsRepoPromptInCurrentSession && (loadedConfig || tunnelConfigured)) {
      process.stdout.write("\n");
    }
  }

  logger.verbose(`Resolving startup mode from '${requestedMode}'.`);
  const mode = await deps.resolvePromptStartupMode(requestedMode, undefined, promptOptions);
  if (requestedMode === "prompt") {
    logger.verbose(`Startup mode selected via prompt: ${mode}.`);
  }
  if (showsPromptInCurrentSession) {
    process.stdout.write("\n");
  }

  const selectReposForCreate = deps.selectReposForCreate ?? selectRepos;
  const selectedRepos = await selectReposForCreate(config.project.repos, config.project.mode, config.project.active, {
    isInteractiveTerminal,
    promptInput: deps.promptInput,
    preferredActiveRepo: undefined,
    activeName: config.project.active_name,
    activeIndex: config.project.active_index,
  });
  if (showsRepoPromptInCurrentSession) {
    process.stdout.write("\n");
  }

  let stopLoading: (() => void) | undefined;
  let completedStageMessage: string | undefined;
  const showStageCompletion = process.stdout.isTTY === true && !isVerboseLoggingEnabled();
  const clearLoadingIfRunning = (): void => {
    stopLoading?.();
    stopLoading = undefined;
    completedStageMessage = undefined;
  };
  const stopLoadingWithCompletion = (): void => {
    stopLoading?.();
    stopLoading = undefined;
    if (completedStageMessage && showStageCompletion) {
      process.stdout.write(`${formatCompletedStage(completedStageMessage)}\n`);
    }
    completedStageMessage = undefined;
  };
  const setLoadingStage = (message: string, completionMessage: string): void => {
    stopLoadingWithCompletion();
    completedStageMessage = completionMessage;
    stopLoading = logger.startLoading(message);
  };
  setLoadingStage("Preparing tunnel...", "Prepared tunnel");

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
  const runWithTunnel = deps.withConfiguredTunnel ?? withConfiguredTunnel;
  return runWithTunnel(config, async (tunnelRuntimeEnv) => {
    setLoadingStage("Resolving environment...", "Resolved environment");
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
    setLoadingStage("Creating sandbox...", "Created sandbox");
    const handle = await deps.createSandbox(createConfig, {
      envs: createEnvs,
      metadata: {
        "launcher.name": displayName,
      },
    });
    const sandboxLabel = formatSandboxDisplayLabel(handle.sandboxId, { "launcher.name": displayName });
    logger.verbose(`Sandbox ready: ${sandboxLabel}.`);

    try {
      await deps.saveLastRunState({
        sandboxId: handle.sandboxId,
        mode,
        activeRepo: undefined,
        updatedAt: deps.now(),
      });

      logger.verbose("Syncing local tooling config/auth.");
      setLoadingStage("Transferring auth/config...", "Transferred auth/config");
      const syncSummary = await deps.syncToolingToSandbox(config, handle, resolvedMode);
      logger.verbose(`Tooling sync: ${formatToolingSyncSummary(syncSummary)}.`);

      setLoadingStage("Bootstrapping workspace...", "Bootstrapped workspace");
      const bootstrapResult = await (deps.bootstrapProjectWorkspace ?? bootstrapProjectWorkspace)(handle, config, {
        isConnect: false,
        runtimeEnv,
        selectedReposOverride: selectedRepos,
        onProgress: (message) => logger.verbose(`Bootstrap: ${message}`),
      });
      logger.verbose(`Selected repos summary: ${formatSelectedReposSummary(bootstrapResult.selectedRepoNames)}.`);
      logger.verbose(`Setup outcome summary: ${formatSetupOutcomeSummary(bootstrapResult.setup)}.`);

      logger.verbose(`Launching startup mode '${mode}'.`);
      setLoadingStage(`Launching ${resolvedMode}...`, `Launched ${resolvedMode}`);
      const launchOptions = {
        workingDirectory: bootstrapResult.workingDirectory,
        startupEnv: addWebServerPasswordForWebMode(
          {
            ...bootstrapResult.startupEnv,
            ...runtimeEnv,
          },
          resolvedMode,
          webServerPassword,
        ),
        ...(resolvedMode === "ssh-opencode"
          ? {
              matchLocalOpenCodeVersion: config.opencode.match_local_version ?? true,
            }
          : {}),
        ...(isInteractiveTerminal() && resolvedMode === "ssh-opencode"
          ? {
              onLaunchStageUpdate: (loadingMessage: string, completionMessage: string) =>
                setLoadingStage(loadingMessage, completionMessage),
            }
          : {}),
      };
      const shouldDelaySpinnerStopForInteractive = resolvedMode !== "web" && isInteractiveTerminal();
      const launched = await deps.launchMode(
        handle,
        mode,
        shouldDelaySpinnerStopForInteractive
          ? {
              ...launchOptions,
              onBeforeInteractiveSession: stopLoadingWithCompletion,
            }
          : launchOptions,
      );
      stopLoadingWithCompletion();

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
        message: `Created sandbox ${sandboxLabel}.${templateSuffix}`,
        postMessages: [launched.message],
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
      clearLoadingIfRunning();
    }
  });
}

function formatCompletedStage(message: string): string {
  const shouldColorize = shouldUseColor(process.stdout);
  const check = shouldColorize ? `${ANSI_GREEN}✓${ANSI_RESET}` : "✓";
  return `${check} ${message}`;
}

function shouldUseColor(output: NodeJS.WriteStream): boolean {
  if (process.env.NO_COLOR !== undefined) {
    return false;
  }

  const forceColor = process.env.FORCE_COLOR;
  if (forceColor !== undefined && forceColor !== "0") {
    return true;
  }

  return output.isTTY === true;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }
  return "unknown error";
}
export { syncToolingForMode };
