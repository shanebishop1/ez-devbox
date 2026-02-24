import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseDotEnv } from "dotenv";
import type { CommandResult } from "../types/index.js";
import type { StartupMode } from "../types/index.js";
import { loadConfig, type LoadConfigOptions } from "../config/load.js";
import { createSandbox, type CreateSandboxOptions, type SandboxHandle } from "../e2b/lifecycle.js";
import { resolveSandboxCreateEnv, type SandboxCreateEnvResolution } from "../e2b/env.js";
import { launchMode, resolveStartupMode, type ConcreteStartupMode, type ModeLaunchResult } from "../modes/index.js";
import { resolvePromptStartupMode } from "./startup-mode-prompt.js";
import { buildSandboxDisplayName, formatSandboxDisplayLabel } from "./sandbox-display-name.js";
import { saveLastRunState, type LastRunState } from "../state/lastRun.js";
import { logger } from "../logging/logger.js";
import { bootstrapProjectWorkspace, type BootstrapProjectWorkspaceResult } from "../project/bootstrap.js";
import { resolveHostGhToken } from "../auth/gh-host-token.js";
import { PromptCancelledError, isPromptCancelledError } from "./prompt-cancelled.js";
import { withConfiguredTunnel } from "../tunnel/cloudflared.js";
import {
  syncCodexAuthFile,
  syncCodexConfigDir,
  syncGhConfigDir,
  syncOpenCodeAuthFile,
  syncOpenCodeConfigDir,
  type DirectorySyncProgress,
  type PathSyncSummary,
  type ToolingSyncSummary
} from "../tooling/host-sandbox-sync.js";

const TOOLING_SYNC_PROGRESS_LOG_INTERVAL = 50;

export interface CreateCommandDeps {
  loadConfig: (options?: LoadConfigOptions) => ReturnType<typeof loadConfig>;
  createSandbox: (
    config: Awaited<ReturnType<typeof loadConfig>>,
    options?: CreateSandboxOptions
  ) => Promise<SandboxHandle>;
  resolveEnvSource: () => Promise<Record<string, string | undefined>>;
  resolveSandboxCreateEnv: (
    config: Awaited<ReturnType<typeof loadConfig>>,
    envSource?: Record<string, string | undefined>
  ) => SandboxCreateEnvResolution;
  resolveHostGhToken?: (env: NodeJS.ProcessEnv) => Promise<string | undefined>;
  resolvePromptStartupMode: (requestedMode: StartupMode) => Promise<StartupMode>;
  launchMode: (handle: SandboxHandle, mode: StartupMode, options?: { workingDirectory?: string; startupEnv?: Record<string, string> }) => Promise<ModeLaunchResult>;
  bootstrapProjectWorkspace?: (
    handle: SandboxHandle,
    config: Awaited<ReturnType<typeof loadConfig>>,
    options?: { isConnect?: boolean; runtimeEnv?: Record<string, string>; onProgress?: (message: string) => void }
  ) => Promise<BootstrapProjectWorkspaceResult>;
  syncToolingToSandbox: (
    config: Awaited<ReturnType<typeof loadConfig>>,
    sandbox: Pick<SandboxHandle, "writeFile">,
    mode: ConcreteStartupMode
  ) => Promise<ToolingSyncSummary>;
  saveLastRunState: (state: LastRunState) => Promise<void>;
  now: () => string;
}

const defaultDeps: CreateCommandDeps = {
  loadConfig,
  createSandbox,
  resolveEnvSource: loadEnvSource,
  resolveSandboxCreateEnv,
  resolvePromptStartupMode,
  launchMode,
  syncToolingToSandbox: syncToolingForMode,
  saveLastRunState,
  now: () => new Date().toISOString()
};

export async function runCreateCommand(args: string[], deps: CreateCommandDeps = defaultDeps): Promise<CommandResult> {
  const parsed = parseCreateArgs(args);
  const config = await deps.loadConfig();
  return withConfiguredTunnel(config, async (tunnelRuntimeEnv) => {
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
              template: templateResolution.template
            }
          };
    const envSource = await deps.resolveEnvSource();
    const envResolution = deps.resolveSandboxCreateEnv(config, envSource);
    const ghRuntimeEnv = await resolveGhRuntimeEnv(config, envSource, deps.resolveHostGhToken);
    const runtimeEnv = {
      ...envResolution.envs,
      ...tunnelRuntimeEnv,
      ...ghRuntimeEnv
    };
    const createEnvs = { ...runtimeEnv };
    logger.verbose(`Creating sandbox with envs: ${JSON.stringify(createEnvs)}`);

    logger.verbose(`Creating sandbox '${displayName}' with template '${createConfig.sandbox.template}'.`);
    const handle = await deps.createSandbox(createConfig, {
      envs: createEnvs,
      metadata: {
        "launcher.name": displayName
      }
    });
    const sandboxLabel = formatSandboxDisplayLabel(handle.sandboxId, { "launcher.name": displayName });
    logger.verbose(`Sandbox ready: ${sandboxLabel}.`);

    let stopLoading: (() => void) | undefined;
    try {
      logger.verbose(`Syncing local tooling config/auth for mode '${resolvedMode}'.`);
      const syncSummary = await deps.syncToolingToSandbox(config, handle, resolvedMode);

      stopLoading = logger.startLoading("Bootstrapping...");
      const bootstrapResult = await (deps.bootstrapProjectWorkspace ?? bootstrapProjectWorkspace)(handle, config, {
        isConnect: false,
        runtimeEnv,
        onProgress: (message) => logger.verbose(`Bootstrap: ${message}`)
      });
      logger.verbose(`Selected repos summary: ${formatSelectedReposSummary(bootstrapResult.selectedRepoNames)}.`);
      logger.verbose(`Setup outcome summary: ${formatSetupOutcomeSummary(bootstrapResult.setup)}.`);

      logger.verbose(`Launching startup mode '${mode}'.`);
      const launched = await deps.launchMode(handle, mode, {
        workingDirectory: bootstrapResult.workingDirectory,
        startupEnv: {
          ...bootstrapResult.startupEnv,
          ...runtimeEnv
        }
      });

      const activeRepo = bootstrapResult.selectedRepoNames.length === 1 ? bootstrapResult.selectedRepoNames[0] : undefined;

      await deps.saveLastRunState({
        sandboxId: handle.sandboxId,
        mode: launched.mode,
        activeRepo,
        updatedAt: deps.now()
      });

      const templateSuffix =
        templateResolution.autoSelected
          ? `\nTemplate auto-selected for ${resolvedMode}: ${templateResolution.template}`
          : "";
      const syncSuffix = `\nTooling sync: ${formatToolingSyncSummary(syncSummary)}`;

      return {
        message: `Created sandbox ${sandboxLabel}. ${launched.message}${templateSuffix}${syncSuffix}`,
        exitCode: 0
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
          { cause: error }
        );
      }

      throw new PromptCancelledError(`Setup selection cancelled; sandbox '${sandboxLabel}' was wiped.`, {
        cause: error
      });
    } finally {
      stopLoading?.();
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

function formatSelectedReposSummary(selectedRepoNames: string[]): string {
  if (selectedRepoNames.length === 0) {
    return "none";
  }
  return selectedRepoNames.join(", ");
}

function formatSetupOutcomeSummary(setup: BootstrapProjectWorkspaceResult["setup"]): string {
  if (setup === null) {
    return "skipped";
  }

  return `ran success=${setup.success} repos=${setup.repos.length}`;
}

export async function syncToolingForMode(
  config: Awaited<ReturnType<typeof loadConfig>>,
  sandbox: Pick<SandboxHandle, "writeFile">,
  mode: ConcreteStartupMode
): Promise<ToolingSyncSummary> {
  const ghConfig = await maybeSyncGhConfig(config, sandbox);

  if (mode === "ssh-opencode" || mode === "web") {
    const opencodeConfig = await runSyncUnit("OpenCode config", (onProgress) =>
      syncOpenCodeConfigDir(config, sandbox, { onProgress })
    );
    const opencodeAuth = await runSyncUnit("OpenCode auth", () => syncOpenCodeAuthFile(config, sandbox));
    return summarizeToolingSync(opencodeConfig, opencodeAuth, null, null, ghConfig, config.gh.enabled);
  }

  if (mode === "ssh-codex") {
    const codexConfig = await runSyncUnit("Codex config", (onProgress) => syncCodexConfigDir(config, sandbox, { onProgress }));
    const codexAuth = await runSyncUnit("Codex auth", () => syncCodexAuthFile(config, sandbox));
    return summarizeToolingSync(null, null, codexConfig, codexAuth, ghConfig, config.gh.enabled);
  }

  const opencodeConfig = await runSyncUnit("OpenCode config", (onProgress) =>
    syncOpenCodeConfigDir(config, sandbox, { onProgress })
  );
  const opencodeAuth = await runSyncUnit("OpenCode auth", () => syncOpenCodeAuthFile(config, sandbox));
  const codexConfig = await runSyncUnit("Codex config", (onProgress) => syncCodexConfigDir(config, sandbox, { onProgress }));
  const codexAuth = await runSyncUnit("Codex auth", () => syncCodexAuthFile(config, sandbox));
  return summarizeToolingSync(opencodeConfig, opencodeAuth, codexConfig, codexAuth, ghConfig, config.gh.enabled);
}

async function maybeSyncGhConfig(
  config: Awaited<ReturnType<typeof loadConfig>>,
  sandbox: Pick<SandboxHandle, "writeFile">
): Promise<PathSyncSummary | null> {
  if (!config.gh.enabled) {
    return null;
  }

  return runSyncUnit("GitHub CLI config", (onProgress) => syncGhConfigDir(config, sandbox, { onProgress }));
}

async function runSyncUnit(
  label: string,
  syncUnit: (onProgress?: (progress: DirectorySyncProgress) => void) => Promise<PathSyncSummary>
): Promise<PathSyncSummary> {
  let lastLoggedCount = 0;
  const onProgress = (progress: DirectorySyncProgress): void => {
    if (progress.filesDiscovered === 0) {
      return;
    }

    const isCompletion = progress.filesWritten === progress.filesDiscovered;
    const reachedInterval = progress.filesWritten - lastLoggedCount >= TOOLING_SYNC_PROGRESS_LOG_INTERVAL;
    if (!isCompletion && !reachedInterval) {
      return;
    }

    lastLoggedCount = progress.filesWritten;
    logger.verbose(`Tooling sync progress: ${label} ${progress.filesWritten}/${progress.filesDiscovered}`);
  };

  logger.verbose(`Tooling sync start: ${label}.`);
  const summary = await syncUnit(onProgress);
  logger.verbose(
    `Tooling sync done: ${label} discovered=${summary.filesDiscovered}, written=${summary.filesWritten}, skippedMissing=${summary.skippedMissing}.`
  );
  return summary;
}

function summarizeToolingSync(
  opencodeConfig: PathSyncSummary | null,
  opencodeAuth: PathSyncSummary | null,
  codexConfig: PathSyncSummary | null,
  codexAuth: PathSyncSummary | null,
  ghConfig: PathSyncSummary | null,
  ghEnabled: boolean
): ToolingSyncSummary {
  const summaries = [opencodeConfig, opencodeAuth, codexConfig, codexAuth, ghConfig].filter(
    (item): item is PathSyncSummary => item !== null
  );

  return {
    totalDiscovered: summaries.reduce((total, item) => total + item.filesDiscovered, 0),
    totalWritten: summaries.reduce((total, item) => total + item.filesWritten, 0),
    skippedMissingPaths: summaries.reduce((total, item) => total + Number(item.skippedMissing), 0),
    opencodeConfigSynced: opencodeConfig !== null && !opencodeConfig.skippedMissing,
    opencodeAuthSynced: opencodeAuth !== null && !opencodeAuth.skippedMissing,
    codexConfigSynced: codexConfig !== null && !codexConfig.skippedMissing,
    codexAuthSynced: codexAuth !== null && !codexAuth.skippedMissing,
    ghEnabled,
    ghConfigSynced: ghConfig !== null && !ghConfig.skippedMissing
  };
}

function formatToolingSyncSummary(summary: ToolingSyncSummary): string {
  const opencodeSynced = summary.opencodeConfigSynced || summary.opencodeAuthSynced;
  const codexSynced = summary.codexConfigSynced || summary.codexAuthSynced;
  const ghSynced = summary.ghEnabled && summary.ghConfigSynced;
  return `discovered=${summary.totalDiscovered}, written=${summary.totalWritten}, missingPaths=${summary.skippedMissingPaths}, opencodeSynced=${opencodeSynced}, codexSynced=${codexSynced}, ghSynced=${ghSynced}`;
}

function resolveTemplateForMode(
  configuredTemplate: string,
  mode: "ssh-opencode" | "ssh-codex" | "web" | "ssh-shell"
): { template: string; autoSelected: boolean } {
  const normalized = configuredTemplate.trim();
  if (normalized !== "" && normalized !== "base") {
    return {
      template: configuredTemplate,
      autoSelected: false
    };
  }

  if (mode === "ssh-codex") {
    return {
      template: "codex",
      autoSelected: true
    };
  }

  return {
    template: "opencode",
    autoSelected: true
  };
}

async function loadEnvSource(): Promise<Record<string, string | undefined>> {
  const envPath = resolve(process.cwd(), ".env");

  let parsedFileEnv: Record<string, string | undefined> = {};

  try {
    parsedFileEnv = parseDotEnv(await readFile(envPath, "utf8"));
  } catch (error) {
    if (!isErrnoException(error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  return {
    ...parsedFileEnv,
    ...process.env
  };
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }
  return "unknown error";
}

function parseCreateArgs(args: string[]): { mode?: StartupMode } {
  let mode: StartupMode | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (token === "--mode") {
      const next = args[index + 1];
      if (!isStartupMode(next)) {
        throw new Error("Invalid value for --mode. Expected one of prompt|ssh-opencode|ssh-codex|web|ssh-shell.");
      }

      mode = next;
      index += 1;
    }
  }

  return { mode };
}

function isStartupMode(value: string | undefined): value is StartupMode {
  return value === "prompt" || value === "ssh-opencode" || value === "ssh-codex" || value === "web" || value === "ssh-shell";
}
