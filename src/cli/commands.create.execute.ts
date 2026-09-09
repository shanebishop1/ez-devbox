import type { LoadConfigOptions, loadConfig, loadConfigWithMetadata } from "../config/load.js";
import type { ResolvedProjectRepoConfig } from "../config/schema.js";
import type { SandboxCreateEnvResolution } from "../e2b/env.js";
import type { CreateSandboxOptions, SandboxHandle } from "../e2b/lifecycle.js";
import { logger } from "../logging/logger.js";
import type { ConcreteStartupMode, ModeLaunchResult } from "../modes/index.js";
import { type BootstrapProjectWorkspaceResult, bootstrapProjectWorkspace } from "../project/bootstrap.js";
import type { SelectReposOptions } from "../project/bootstrap.repo-selection.js";
import type { LastRunState } from "../state/lastRun.js";
import type { ToolingSyncSummary } from "../tooling/host-sandbox-sync.js";
import type { WithConfiguredTunnel } from "../tunnel/cloudflared.js";
import type { CommandResult, StartupMode } from "../types/index.js";
import type { createLoadingStageController } from "./command-loading.js";
import {
  addWebServerPasswordForWebMode,
  formatSelectedReposSummary,
  formatSetupOutcomeSummary,
} from "./command-shared.js";
import { formatToolingSyncSummary } from "./commands.create.sync.js";
import { formatCreateLaunchResult } from "./launch-output.js";
import { isPromptCancelledError, PromptCancelledError } from "./prompt-cancelled.js";
import type { StartupModePromptDeps, StartupModePromptOptions } from "./startup-mode-prompt.js";
import { asStructuredCliError, createFailureCode } from "./structured-error.js";

type LauncherConfig = Awaited<ReturnType<typeof loadConfig>>;
type LoadingStageController = ReturnType<typeof createLoadingStageController>;

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
      nonInteractive?: boolean;
      detach?: boolean;
      prompt?: { kind: "initial" | "follow-up"; text: string };
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
    sandbox: Pick<SandboxHandle, "run" | "writeFile">,
    mode: ConcreteStartupMode,
  ) => Promise<ToolingSyncSummary>;
  saveLastRunState: (state: LastRunState) => Promise<void>;
  now: () => string;
  withConfiguredTunnel?: WithConfiguredTunnel;
}

export interface CreateExecutionOptions {
  deps: CreateCommandDeps;
  config: LauncherConfig;
  template: string;
  handle: SandboxHandle;
  mode: StartupMode;
  resolvedMode: ConcreteStartupMode;
  sandboxLabel: string;
  selectedRepos: ResolvedProjectRepoConfig[];
  runtimeEnv: Record<string, string>;
  webServerPassword?: string;
  shouldDetach: boolean;
  promptText?: string;
  json: boolean;
  templateAutoSelected: boolean;
  isInteractiveTerminal: () => boolean;
  loading: LoadingStageController;
}

export async function executeCreateWorkflow(options: CreateExecutionOptions): Promise<CommandResult> {
  const {
    deps,
    config,
    template,
    handle,
    mode,
    resolvedMode,
    sandboxLabel,
    selectedRepos,
    runtimeEnv,
    webServerPassword,
    shouldDetach,
    promptText,
    json,
    templateAutoSelected,
    isInteractiveTerminal,
    loading,
  } = options;
  let failedStage = "state-save";

  try {
    await deps.saveLastRunState({
      sandboxId: handle.sandboxId,
      mode,
      activeRepo: undefined,
      updatedAt: deps.now(),
    });

    logger.verbose("Syncing local tooling config/auth.");
    failedStage = "tooling-sync";
    loading.setStage("Transferring auth/config...", "Transferred auth/config");
    const syncSummary = await deps.syncToolingToSandbox(config, handle, resolvedMode);
    logger.verbose(`Tooling sync: ${formatToolingSyncSummary(syncSummary)}.`);

    loading.setStage("Bootstrapping workspace...", "Bootstrapped workspace");
    failedStage = "workspace-bootstrap";
    const bootstrapResult = await (deps.bootstrapProjectWorkspace ?? bootstrapProjectWorkspace)(handle, config, {
      isConnect: false,
      runtimeEnv,
      selectedReposOverride: selectedRepos,
      onProgress: (message) => logger.verbose(`Bootstrap: ${message}`),
    });
    logger.verbose(`Selected repos summary: ${formatSelectedReposSummary(bootstrapResult.selectedRepoNames)}.`);
    logger.verbose(`Setup outcome summary: ${formatSetupOutcomeSummary(bootstrapResult.setup)}.`);

    logger.verbose(`Launching startup mode '${mode}'.`);
    failedStage = promptText ? "initial-prompt" : "agent-startup";
    loading.setStage(`Launching ${resolvedMode}...`, `Launched ${resolvedMode}`);
    const launchOptions = {
      workingDirectory: bootstrapResult.workingDirectory,
      ...(shouldDetach ? { detach: true } : {}),
      ...(promptText ? { prompt: { kind: "initial" as const, text: promptText } } : {}),
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
              loading.setStage(loadingMessage, completionMessage),
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
            onBeforeInteractiveSession: loading.finish,
          }
        : launchOptions,
    );
    loading.finish();

    const activeRepo =
      bootstrapResult.selectedRepoNames.length === 1 ? bootstrapResult.selectedRepoNames[0] : undefined;

    failedStage = "state-save";
    await deps.saveLastRunState({
      sandboxId: handle.sandboxId,
      mode: launched.mode,
      activeRepo,
      updatedAt: deps.now(),
    });

    return formatCreateLaunchResult({
      json,
      sandboxId: handle.sandboxId,
      sandboxLabel,
      launched,
      shouldDetach,
      promptText,
      bootstrap: bootstrapResult,
      activeRepo,
      template,
      templateAutoSelected,
      resolvedMode,
      toolingSync: syncSummary,
    });
  } catch (error) {
    if (!isPromptCancelledError(error)) {
      throw asStructuredCliError(error, {
        code: createFailureCode(failedStage),
        stage: failedStage,
        sandboxId: handle.sandboxId,
      });
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
    loading.clear();
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }
  return "unknown error";
}
