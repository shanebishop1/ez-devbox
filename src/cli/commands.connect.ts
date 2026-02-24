import { createInterface } from "node:readline/promises";
import type { CommandResult } from "../types/index.js";
import type { StartupMode } from "../types/index.js";
import { loadConfig, type LoadConfigOptions } from "../config/load.js";
import {
  connectSandbox,
  listSandboxes,
  type LifecycleOperationOptions,
  type ListSandboxesOptions,
  type SandboxHandle,
  type SandboxListItem
} from "../e2b/lifecycle.js";
import { launchMode, resolveStartupMode, type ConcreteStartupMode, type ModeLaunchResult } from "../modes/index.js";
import { loadLastRunState, saveLastRunState, type LastRunState } from "../state/lastRun.js";
import { logger } from "../logging/logger.js";
import { formatSandboxDisplayLabel } from "./sandbox-display-name.js";
import {
  syncCodexAuthFile,
  syncCodexConfigDir,
  syncOpenCodeAuthFile,
  syncOpenCodeConfigDir,
  type DirectorySyncProgress,
  type PathSyncSummary,
  type ToolingSyncSummary
} from "../tooling/host-sandbox-sync.js";
import { resolvePromptStartupMode } from "./startup-mode-prompt.js";

const TOOLING_SYNC_PROGRESS_LOG_INTERVAL = 50;

export interface ConnectCommandDeps {
  loadConfig: (options?: LoadConfigOptions) => ReturnType<typeof loadConfig>;
  connectSandbox: (
    sandboxId: string,
    config: Awaited<ReturnType<typeof loadConfig>>,
    options?: LifecycleOperationOptions
  ) => Promise<SandboxHandle>;
  loadLastRunState: () => Promise<LastRunState | null>;
  listSandboxes: (options?: ListSandboxesOptions) => Promise<SandboxListItem[]>;
  resolvePromptStartupMode: (requestedMode: StartupMode) => Promise<StartupMode>;
  launchMode: (handle: SandboxHandle, mode: StartupMode) => Promise<ModeLaunchResult>;
  syncToolingToSandbox: (
    config: Awaited<ReturnType<typeof loadConfig>>,
    sandbox: Pick<SandboxHandle, "writeFile">,
    mode: ConcreteStartupMode
  ) => Promise<ToolingSyncSummary>;
  saveLastRunState: (state: LastRunState) => Promise<void>;
  isInteractiveTerminal?: () => boolean;
  promptInput?: (question: string) => Promise<string>;
  now: () => string;
}

const defaultDeps: ConnectCommandDeps = {
  loadConfig,
  connectSandbox,
  loadLastRunState,
  listSandboxes,
  resolvePromptStartupMode,
  launchMode,
  syncToolingToSandbox: syncToolingForMode,
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
  const config = await deps.loadConfig();

  const target = await resolveSandboxTarget(parsed.sandboxId, deps, options);
  const targetLabel = target.label ?? target.sandboxId;
  const requestedMode = parsed.mode ?? config.startup.mode;
  logger.info(`Resolving startup mode from '${requestedMode}'.`);
  const mode = await deps.resolvePromptStartupMode(requestedMode);
  if (requestedMode === "prompt") {
    logger.info(`Startup mode selected via prompt: ${mode}.`);
  }
  const resolvedMode = resolveStartupMode(mode);

  logger.info(`Connecting to sandbox ${targetLabel}.`);
  const handle = await deps.connectSandbox(target.sandboxId, config);
  logger.info(`Connected to sandbox ${targetLabel}.`);

  logger.info(`Syncing local tooling config/auth for mode '${resolvedMode}'.`);
  const syncSummary = await deps.syncToolingToSandbox(config, handle, resolvedMode);

  logger.info(`Launching startup mode '${mode}'.`);
  const launched = await deps.launchMode(handle, mode);

  await deps.saveLastRunState({
    sandboxId: handle.sandboxId,
    mode: launched.mode,
    updatedAt: deps.now()
  });

  return {
    message: `Connected to sandbox ${targetLabel}. ${launched.message}\nTooling sync: ${formatToolingSyncSummary(syncSummary)}`,
    exitCode: 0
  };
}

async function syncToolingForMode(
  config: Awaited<ReturnType<typeof loadConfig>>,
  sandbox: Pick<SandboxHandle, "writeFile">,
  mode: ConcreteStartupMode
): Promise<ToolingSyncSummary> {
  if (mode === "ssh-opencode" || mode === "web") {
    const opencodeConfig = await runSyncUnit("OpenCode config", (onProgress) =>
      syncOpenCodeConfigDir(config, sandbox, { onProgress })
    );
    const opencodeAuth = await runSyncUnit("OpenCode auth", () => syncOpenCodeAuthFile(config, sandbox));
    return summarizeToolingSync(opencodeConfig, opencodeAuth, null, null);
  }

  if (mode === "ssh-codex") {
    const codexConfig = await runSyncUnit("Codex config", (onProgress) => syncCodexConfigDir(config, sandbox, { onProgress }));
    const codexAuth = await runSyncUnit("Codex auth", () => syncCodexAuthFile(config, sandbox));
    return summarizeToolingSync(null, null, codexConfig, codexAuth);
  }

  const opencodeConfig = await runSyncUnit("OpenCode config", (onProgress) =>
    syncOpenCodeConfigDir(config, sandbox, { onProgress })
  );
  const opencodeAuth = await runSyncUnit("OpenCode auth", () => syncOpenCodeAuthFile(config, sandbox));
  const codexConfig = await runSyncUnit("Codex config", (onProgress) => syncCodexConfigDir(config, sandbox, { onProgress }));
  const codexAuth = await runSyncUnit("Codex auth", () => syncCodexAuthFile(config, sandbox));
  return summarizeToolingSync(opencodeConfig, opencodeAuth, codexConfig, codexAuth);
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
    logger.info(`Tooling sync progress: ${label} ${progress.filesWritten}/${progress.filesDiscovered}`);
  };

  logger.info(`Tooling sync start: ${label}.`);
  const summary = await syncUnit(onProgress);
  logger.info(
    `Tooling sync done: ${label} discovered=${summary.filesDiscovered}, written=${summary.filesWritten}, skippedMissing=${summary.skippedMissing}.`
  );
  return summary;
}

function summarizeToolingSync(
  opencodeConfig: PathSyncSummary | null,
  opencodeAuth: PathSyncSummary | null,
  codexConfig: PathSyncSummary | null,
  codexAuth: PathSyncSummary | null
): ToolingSyncSummary {
  const summaries = [opencodeConfig, opencodeAuth, codexConfig, codexAuth].filter((item): item is PathSyncSummary => item !== null);

  return {
    totalDiscovered: summaries.reduce((total, item) => total + item.filesDiscovered, 0),
    totalWritten: summaries.reduce((total, item) => total + item.filesWritten, 0),
    skippedMissingPaths: summaries.reduce((total, item) => total + Number(item.skippedMissing), 0),
    opencodeConfigSynced: opencodeConfig !== null && !opencodeConfig.skippedMissing,
    opencodeAuthSynced: opencodeAuth !== null && !opencodeAuth.skippedMissing,
    codexConfigSynced: codexConfig !== null && !codexConfig.skippedMissing,
    codexAuthSynced: codexAuth !== null && !codexAuth.skippedMissing
  };
}

function formatToolingSyncSummary(summary: ToolingSyncSummary): string {
  const opencodeSynced = summary.opencodeConfigSynced || summary.opencodeAuthSynced;
  const codexSynced = summary.codexConfigSynced || summary.codexAuthSynced;
  return `discovered=${summary.totalDiscovered}, written=${summary.totalWritten}, missingPaths=${summary.skippedMissingPaths}, opencodeSynced=${opencodeSynced}, codexSynced=${codexSynced}`;
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
      logger.info(`Selected fallback sandbox: ${fallbackLabel}.`);
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
        logger.info(`Selected fallback sandbox: ${fallbackLabel}.`);
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
    ...options.map((option) => `${option.index}) ${option.label}`),
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

function parseConnectArgs(args: string[]): { sandboxId?: string; mode?: StartupMode } {
  let sandboxId: string | undefined;
  let mode: StartupMode | undefined;

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
      if (!isStartupMode(next)) {
        throw new Error("Invalid value for --mode. Expected one of prompt|ssh-opencode|ssh-codex|web|ssh-shell.");
      }
      mode = next;
      index += 1;
    }
  }

  return { sandboxId, mode };
}

function isStartupMode(value: string | undefined): value is StartupMode {
  return value === "prompt" || value === "ssh-opencode" || value === "ssh-codex" || value === "web" || value === "ssh-shell";
}
