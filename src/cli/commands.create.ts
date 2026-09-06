import { loadConfig, loadConfigWithMetadata } from "../config/load.js";
import { resolveSandboxCreateEnv } from "../e2b/env.js";
import { createSandbox, type SandboxHandle } from "../e2b/lifecycle.js";
import { isVerboseLoggingEnabled, logger } from "../logging/logger.js";
import { launchMode, resolveStartupMode } from "../modes/index.js";
import { selectRepos } from "../project/bootstrap.repo-selection.js";
import { saveLastRunState } from "../state/lastRun.js";
import { withConfiguredTunnel } from "../tunnel/cloudflared.js";
import { resolveTunnelPorts } from "../tunnel/cloudflared.spawn.js";
import type { CommandResult } from "../types/index.js";
import { formatEnvVarNames, resolveGhRuntimeEnv } from "./command-env.js";
import { createLoadingStageController } from "./command-loading.js";
import { removeOpenCodeServerPassword, resolveWebServerPassword } from "./command-shared.js";
import { parseCreateArgs } from "./commands.create.args.js";
import { type CreateCommandDeps, executeCreateWorkflow } from "./commands.create.execute.js";
import { syncToolingForMode } from "./commands.create.sync.js";
import { resolveTemplateForMode } from "./commands.create.template.js";
import { loadCliEnvSource } from "./env-source.js";
import { resolveDetachedLaunch } from "./launch-output.js";
import { readPromptInput, validatePromptText } from "./prompt-input.js";
import { formatPromptLogTag, renderPromptWizardHeader, SSH_SUSPEND_RESUME_HINT } from "./prompt-style.js";
import { buildSandboxDisplayName, formatSandboxDisplayLabel } from "./sandbox-display-name.js";
import { resolvePromptStartupMode } from "./startup-mode-prompt.js";
import { asStructuredCliError } from "./structured-error.js";

export type { CreateCommandDeps } from "./commands.create.execute.js";

const TUNNEL_URL_WARNING_MESSAGE =
  "Anyone with access to your Tunnel URL can access the forwarded service/data. Treat tunnel URLs as secrets.";
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
  const configuredInteractiveTerminal =
    deps.isInteractiveTerminal ?? (() => Boolean(process.stdin.isTTY && process.stdout.isTTY));
  const shouldDetach = resolveDetachedLaunch(
    parsed.detach,
    deps.isInteractiveTerminal,
    deps === defaultDeps,
    configuredInteractiveTerminal,
  );
  const isInteractiveTerminal = parsed.json ? () => false : configuredInteractiveTerminal;
  const promptText = validatePromptText(
    await readPromptInput({ promptFile: parsed.promptFile, promptStdin: parsed.promptStdin }),
  );
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

  if (!parsed.json && isInteractiveTerminal() && !showsPromptInCurrentSession) {
    process.stdout.write(`${renderPromptWizardHeader("ez-devbox")}\n\n`);
  }

  if (!showsPromptInCurrentSession) {
    if (isInteractiveTerminal() && !parsed.json) {
      logger.info(SSH_SUSPEND_RESUME_HINT);
    }
    if (loadedConfig && !parsed.json) {
      logger.info(`Using launcher config: ${loadedConfig.configPath}`);
    }
    if (tunnelConfigured && !parsed.json) {
      logger.warn(TUNNEL_URL_WARNING_MESSAGE);
    }
    if (showsRepoPromptInCurrentSession && (loadedConfig || tunnelConfigured)) {
      process.stdout.write("\n");
    }
  }

  logger.verbose(`Resolving startup mode from '${requestedMode}'.`);
  const mode = await deps.resolvePromptStartupMode(
    requestedMode,
    parsed.json
      ? {
          isInteractiveTerminal: () => false,
          promptInput: async () => "",
        }
      : undefined,
    promptOptions,
  );
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

  const loading = createLoadingStageController({
    enabled: !parsed.json,
    showCompletion: process.stdout.isTTY === true && !isVerboseLoggingEnabled(),
    honorForceColor: true,
  });
  loading.setStage("Preparing tunnel...", "Prepared tunnel");

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
    loading.setStage("Resolving environment...", "Resolved environment");
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
    loading.setStage("Creating sandbox...", "Created sandbox");
    let handle: SandboxHandle;
    try {
      handle = await deps.createSandbox(createConfig, {
        envs: createEnvs,
        metadata: {
          "launcher.name": displayName,
        },
      });
    } catch (error) {
      throw asStructuredCliError(error, { code: "SANDBOX_CREATE_FAILED", stage: "sandbox-create" });
    }
    const sandboxLabel = formatSandboxDisplayLabel(handle.sandboxId, { "launcher.name": displayName });
    logger.verbose(`Sandbox ready: ${sandboxLabel}.`);
    return executeCreateWorkflow({
      deps,
      config,
      template: createConfig.sandbox.template,
      handle,
      mode,
      resolvedMode,
      sandboxLabel,
      selectedRepos,
      runtimeEnv,
      webServerPassword,
      shouldDetach,
      promptText,
      json: parsed.json,
      templateAutoSelected: templateResolution.autoSelected,
      isInteractiveTerminal,
      loading,
    });
  });
}

export { syncToolingForMode };
