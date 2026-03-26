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
import { renderPromptWizardHeader, SSH_SUSPEND_RESUME_HINT } from "./prompt-style.js";
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
    options?: {
      workingDirectory?: string;
      startupEnv?: Record<string, string>;
      matchLocalOpenCodeVersion?: boolean;
      onBeforeInteractiveSession?: () => void;
    },
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
  skipDetachHint?: boolean;
  skipInteractiveHeader?: boolean;
}

export async function runConnectCommand(
  args: string[],
  deps: ConnectCommandDeps = defaultDeps,
  options: ConnectCommandOptions = {},
): Promise<CommandResult> {
  const parsed = parseConnectArgs(args);
  const loadedConfig = deps.loadConfigWithMetadata ? await deps.loadConfigWithMetadata() : undefined;
  const config = loadedConfig ? loadedConfig.config : await deps.loadConfig();
  const isInteractive = (deps.isInteractiveTerminal ?? (() => Boolean(process.stdin.isTTY && process.stdout.isTTY)))();
  const requestedMode = parsed.mode ?? config.startup.mode;
  const showsPromptInCurrentSession = requestedMode === "prompt" && isInteractive;

  if (!parsed.json && isInteractive && !options.skipInteractiveHeader && !showsPromptInCurrentSession) {
    process.stdout.write(`${renderPromptWizardHeader("ez-devbox")}\n\n`);
  }
  if (!parsed.json && isInteractive && !options.skipDetachHint && !showsPromptInCurrentSession) {
    logger.info(SSH_SUSPEND_RESUME_HINT);
    process.stdout.write("\n");
  }

  const showLoading = Boolean(process.stdout.isTTY && !parsed.json);
  let stopLoading: (() => void) | undefined;
  let completedStageMessage: string | undefined;
  const clearLoadingIfRunning = (): void => {
    stopLoading?.();
    stopLoading = undefined;
    completedStageMessage = undefined;
  };
  const stopLoadingWithCompletion = (): void => {
    stopLoading?.();
    stopLoading = undefined;
    if (completedStageMessage && showLoading) {
      process.stdout.write(`${formatCompletedStage(completedStageMessage)}\n`);
    }
    completedStageMessage = undefined;
  };
  const setLoadingStage = (message: string, completionMessage: string): void => {
    if (!showLoading) {
      return;
    }
    stopLoadingWithCompletion();
    completedStageMessage = completionMessage;
    stopLoading = logger.startLoading(message);
  };
  setLoadingStage("Preparing tunnel...", "Prepared tunnel");

  return withConfiguredTunnel(config, async (tunnelRuntimeEnv) => {
    setLoadingStage("Resolving target sandbox...", "Resolved target sandbox");
    const target = await resolveSandboxTarget(parsed.sandboxId, deps, options);
    const targetLabel = target.label ?? target.sandboxId;
    logger.verbose(`Resolving startup mode from '${requestedMode}'.`);
    const mode = await deps.resolvePromptStartupMode(requestedMode);
    const resolvedMode = resolveStartupMode(mode);
    if (requestedMode === "prompt") {
      logger.verbose(`Startup mode selected via prompt: ${mode}.`);
      if (!parsed.json && isInteractive && !options.skipDetachHint) {
        logger.info(SSH_SUSPEND_RESUME_HINT);
        process.stdout.write("\n");
      }
    }
    const preferredActiveRepo = await resolvePreferredActiveRepo(config, target.sandboxId, deps, options);

    logger.verbose(`Connecting to sandbox ${targetLabel}.`);
    setLoadingStage("Connecting to sandbox...", "Connected to sandbox");
    const handle = await deps.connectSandbox(target.sandboxId, config);
    logger.verbose(`Connected to sandbox ${targetLabel}.`);

    await deps.saveLastRunState({
      sandboxId: handle.sandboxId,
      mode,
      activeRepo: preferredActiveRepo,
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

    setLoadingStage("Bootstrapping workspace...", "Bootstrapped workspace");
    const bootstrapResult = await (deps.bootstrapProjectWorkspace ?? bootstrapProjectWorkspace)(handle, config, {
      isConnect: true,
      preferredActiveRepo,
      runtimeEnv,
      onProgress: (message) => logger.verbose(`Bootstrap: ${message}`),
    });
    logger.verbose(`Selected repos summary: ${formatSelectedReposSummary(bootstrapResult.selectedRepoNames)}.`);
    logger.verbose(`Setup outcome summary: ${formatSetupOutcomeSummary(bootstrapResult.setup)}.`);

    if (!parsed.json && showLoading && resolvedMode !== "web") {
      logger.info(`Connected to sandbox ${targetLabel}.`);
      process.stdout.write("\n");
    }

    logger.verbose(`Launching startup mode '${mode}'.`);
    setLoadingStage(`Launching ${resolvedMode}...`, `Launched ${resolvedMode}`);
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
      ...(resolvedMode === "ssh-opencode"
        ? {
            matchLocalOpenCodeVersion: config.opencode.match_local_version ?? true,
          }
        : {}),
      ...(resolvedMode !== "web" && showLoading
        ? {
            onBeforeInteractiveSession: () => {
              stopLoadingWithCompletion();
              process.stdout.write("\n");
            },
          }
        : {}),
    });
    stopLoadingWithCompletion();

    const activeRepo =
      bootstrapResult.selectedRepoNames.length === 1 ? bootstrapResult.selectedRepoNames[0] : undefined;

    await deps.saveLastRunState({
      sandboxId: handle.sandboxId,
      mode: launched.mode,
      activeRepo,
      updatedAt: deps.now(),
    });

    if (!parsed.json && showLoading && resolvedMode !== "web") {
      process.stdout.write("\n");
    }

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

    return !parsed.json && showLoading && resolvedMode !== "web"
      ? {
          message: launched.message,
          exitCode: 0,
        }
      : {
          message: `Connected to sandbox ${targetLabel}. ${launched.message}`,
          exitCode: 0,
        };
  }).finally(() => {
    clearLoadingIfRunning();
  });
}

const ANSI_GREEN = "\u001b[32m";
const ANSI_RESET = "\u001b[0m";

function formatCompletedStage(message: string): string {
  const shouldColorize = process.stdout.isTTY === true && process.env.NO_COLOR === undefined;
  const check = shouldColorize ? `${ANSI_GREEN}✓${ANSI_RESET}` : "✓";
  return `${check} ${message}`;
}
