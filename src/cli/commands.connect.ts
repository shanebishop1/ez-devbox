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
import {
  syncCodexAuthFile,
  syncCodexConfigDir,
  syncOpenCodeAuthFile,
  syncOpenCodeConfigDir,
  type PathSyncSummary,
  type ToolingSyncSummary
} from "../tooling/host-sandbox-sync.js";

export interface ConnectCommandDeps {
  loadConfig: (options?: LoadConfigOptions) => ReturnType<typeof loadConfig>;
  connectSandbox: (
    sandboxId: string,
    config: Awaited<ReturnType<typeof loadConfig>>,
    options?: LifecycleOperationOptions
  ) => Promise<SandboxHandle>;
  loadLastRunState: () => Promise<LastRunState | null>;
  listSandboxes: (options?: ListSandboxesOptions) => Promise<SandboxListItem[]>;
  launchMode: (handle: SandboxHandle, mode: StartupMode) => Promise<ModeLaunchResult>;
  syncToolingToSandbox: (
    config: Awaited<ReturnType<typeof loadConfig>>,
    sandbox: Pick<SandboxHandle, "writeFile">,
    mode: ConcreteStartupMode
  ) => Promise<ToolingSyncSummary>;
  saveLastRunState: (state: LastRunState) => Promise<void>;
  now: () => string;
}

const defaultDeps: ConnectCommandDeps = {
  loadConfig,
  connectSandbox,
  loadLastRunState,
  listSandboxes,
  launchMode,
  syncToolingToSandbox: syncToolingForMode,
  saveLastRunState,
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

  const sandboxId = await resolveSandboxId(parsed.sandboxId, deps, options);
  const mode = parsed.mode ?? config.startup.mode;
  const resolvedMode = resolveStartupMode(mode);

  const handle = await deps.connectSandbox(sandboxId, config);
  const syncSummary = await deps.syncToolingToSandbox(config, handle, resolvedMode);
  const launched = await deps.launchMode(handle, mode);

  await deps.saveLastRunState({
    sandboxId: handle.sandboxId,
    mode: launched.mode,
    updatedAt: deps.now()
  });

  return {
    message: `Connected to sandbox ${handle.sandboxId}. ${launched.message}\nTooling sync: ${formatToolingSyncSummary(syncSummary)}`,
    exitCode: 0
  };
}

async function syncToolingForMode(
  config: Awaited<ReturnType<typeof loadConfig>>,
  sandbox: Pick<SandboxHandle, "writeFile">,
  mode: ConcreteStartupMode
): Promise<ToolingSyncSummary> {
  if (mode === "ssh-opencode" || mode === "web") {
    const opencodeConfig = await syncOpenCodeConfigDir(config, sandbox);
    const opencodeAuth = await syncOpenCodeAuthFile(config, sandbox);
    return summarizeToolingSync(opencodeConfig, opencodeAuth, null, null);
  }

  if (mode === "ssh-codex") {
    const codexConfig = await syncCodexConfigDir(config, sandbox);
    const codexAuth = await syncCodexAuthFile(config, sandbox);
    return summarizeToolingSync(null, null, codexConfig, codexAuth);
  }

  const opencodeConfig = await syncOpenCodeConfigDir(config, sandbox);
  const opencodeAuth = await syncOpenCodeAuthFile(config, sandbox);
  const codexConfig = await syncCodexConfigDir(config, sandbox);
  const codexAuth = await syncCodexAuthFile(config, sandbox);
  return summarizeToolingSync(opencodeConfig, opencodeAuth, codexConfig, codexAuth);
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

async function resolveSandboxId(
  sandboxIdArg: string | undefined,
  deps: ConnectCommandDeps,
  options: ConnectCommandOptions
): Promise<string> {
  if (sandboxIdArg) {
    return sandboxIdArg;
  }

  if (!options.skipLastRun) {
    const lastRun = await deps.loadLastRunState();
    if (lastRun?.sandboxId) {
      return lastRun.sandboxId;
    }
  }

  const sandboxes = await deps.listSandboxes();
  const firstSandbox = sandboxes[0];
  if (!firstSandbox) {
    throw new Error("No sandboxes are available to connect.");
  }

  return firstSandbox.sandboxId;
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
