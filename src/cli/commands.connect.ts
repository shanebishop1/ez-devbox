import { loadConfig, loadConfigWithMetadata } from "../config/load.js";
import { resolveSandboxCreateEnv } from "../e2b/env.js";
import { connectSandbox, listSandboxes, type SandboxHandle } from "../e2b/lifecycle.js";
import { logger } from "../logging/logger.js";
import { launchMode, type ModeLaunchResult, resolveStartupMode } from "../modes/index.js";
import { type BootstrapProjectWorkspaceResult, bootstrapProjectWorkspace } from "../project/bootstrap.js";
import { loadLastRunState, saveLastRunState } from "../state/lastRun.js";
import { withConfiguredTunnel } from "../tunnel/cloudflared.js";
import type { CommandResult } from "../types/index.js";
import { resolveGhRuntimeEnv } from "./command-env.js";
import { createLoadingStageController } from "./command-loading.js";
import {
  addWebServerPasswordForWebMode,
  formatSelectedReposSummary,
  formatSetupOutcomeSummary,
  removeOpenCodeServerPassword,
  resolveWebServerPassword,
} from "./command-shared.js";
import { type ConnectCommandOptions, parseConnectArgs } from "./commands.connect.args.js";
import { resolvePreferredActiveRepo, resolveSandboxTarget } from "./commands.connect.target.js";
import type { ConnectCommandDeps } from "./commands.connect.types.js";
import { loadCliEnvSource } from "./env-source.js";
import { formatConnectLaunchResult, resolveDetachedLaunch } from "./launch-output.js";
import { readPromptInput, validatePromptText } from "./prompt-input.js";
import { renderPromptWizardHeader, SSH_SUSPEND_RESUME_HINT } from "./prompt-style.js";
import { resolvePromptStartupMode } from "./startup-mode-prompt.js";
import { asStructuredCliError } from "./structured-error.js";

export type { ConnectCommandDeps } from "./commands.connect.types.js";

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

export type { ConnectCommandOptions } from "./commands.connect.args.js";

export async function runConnectCommand(
  args: string[],
  deps: ConnectCommandDeps = defaultDeps,
  options: ConnectCommandOptions = {},
): Promise<CommandResult> {
  const parsed = parseConnectArgs(args);
  const loadedConfig = deps.loadConfigWithMetadata ? await deps.loadConfigWithMetadata() : undefined;
  const config = loadedConfig ? loadedConfig.config : await deps.loadConfig();
  const configuredInteractiveTerminal =
    deps.isInteractiveTerminal ?? (() => Boolean(process.stdin.isTTY && process.stdout.isTTY));
  const isInteractive = !parsed.json && configuredInteractiveTerminal();
  const shouldDetach = resolveDetachedLaunch(
    parsed.detach,
    deps.isInteractiveTerminal,
    deps === defaultDeps,
    configuredInteractiveTerminal,
  );
  const promptText = validatePromptText(
    await readPromptInput({ promptFile: parsed.promptFile, promptStdin: parsed.promptStdin }),
  );
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
  const loading = createLoadingStageController({ enabled: showLoading, showCompletion: showLoading });
  const target = await resolveSandboxTarget(
    parsed.sandboxId,
    {
      ...deps,
      ...(parsed.json ? { isInteractiveTerminal: () => false } : {}),
    },
    options,
  );
  const targetLabel = target.label ?? target.sandboxId;
  logger.verbose(`Resolving startup mode from '${requestedMode}'.`);
  const mode = parsed.json
    ? await deps.resolvePromptStartupMode(requestedMode, {
        isInteractiveTerminal: () => false,
        promptInput: async () => "",
      })
    : await deps.resolvePromptStartupMode(requestedMode);
  const resolvedMode = resolveStartupMode(mode);
  if (requestedMode === "prompt") {
    logger.verbose(`Startup mode selected via prompt: ${mode}.`);
    if (!parsed.json && isInteractive && !options.skipDetachHint) {
      logger.info(SSH_SUSPEND_RESUME_HINT);
      process.stdout.write("\n");
    }
  }
  const preferredActiveRepo = await resolvePreferredActiveRepo(config, target.sandboxId, deps, options);

  loading.setStage("Preparing tunnel...", "Prepared tunnel");
  return withConfiguredTunnel(config, async (tunnelRuntimeEnv) => {
    logger.verbose(`Connecting to sandbox ${targetLabel}.`);
    loading.setStage("Connecting to sandbox...", "Connected to sandbox");
    let handle: SandboxHandle;
    try {
      handle = await deps.connectSandbox(target.sandboxId, config);
    } catch (error) {
      throw asStructuredCliError(error, {
        code: "SANDBOX_CONNECT_FAILED",
        stage: "sandbox-connect",
        sandboxId: target.sandboxId,
      });
    }
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

    loading.setStage("Bootstrapping workspace...", "Bootstrapped workspace");
    let bootstrapResult: BootstrapProjectWorkspaceResult;
    try {
      bootstrapResult = await (deps.bootstrapProjectWorkspace ?? bootstrapProjectWorkspace)(handle, config, {
        isConnect: true,
        ...(parsed.json ? { isInteractiveTerminal: () => false } : {}),
        preferredActiveRepo,
        runtimeEnv,
        onProgress: (message) => logger.verbose(`Bootstrap: ${message}`),
      });
    } catch (error) {
      throw asStructuredCliError(error, {
        code: "WORKSPACE_BOOTSTRAP_FAILED",
        stage: "workspace-bootstrap",
        sandboxId: handle.sandboxId,
      });
    }
    logger.verbose(`Selected repos summary: ${formatSelectedReposSummary(bootstrapResult.selectedRepoNames)}.`);
    logger.verbose(`Setup outcome summary: ${formatSetupOutcomeSummary(bootstrapResult.setup)}.`);

    if (!parsed.json && showLoading && resolvedMode !== "web") {
      logger.info(`Connected to sandbox ${targetLabel}.`);
      process.stdout.write("\n");
    }

    logger.verbose(`Launching startup mode '${mode}'.`);
    loading.setStage(`Launching ${resolvedMode}...`, `Launched ${resolvedMode}`);
    let launched: ModeLaunchResult;
    try {
      launched = await deps.launchMode(handle, mode, {
        workingDirectory: bootstrapResult.workingDirectory,
        ...(shouldDetach ? { detach: true } : {}),
        ...(promptText ? { prompt: { kind: "follow-up" as const, text: promptText } } : {}),
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
                loading.finish();
                process.stdout.write("\n");
              },
            }
          : {}),
      });
    } catch (error) {
      throw asStructuredCliError(error, {
        code: "AGENT_START_FAILED",
        stage: promptText ? "prompt-delivery" : "agent-startup",
        sandboxId: handle.sandboxId,
      });
    }
    loading.finish();

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

    return formatConnectLaunchResult({
      json: parsed.json,
      showLoading,
      resolvedMode,
      sandboxId: handle.sandboxId,
      sandboxLabel: targetLabel,
      launched,
      shouldDetach,
      promptText,
      bootstrap: bootstrapResult,
      activeRepo,
    });
  }).finally(() => {
    loading.clear();
  });
}
