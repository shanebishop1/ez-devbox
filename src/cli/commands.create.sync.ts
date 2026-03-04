import type { loadConfig } from "../config/load.js";
import type { SandboxHandle } from "../e2b/lifecycle.js";
import { logger } from "../logging/logger.js";
import type { ConcreteStartupMode } from "../modes/index.js";
import {
  type DirectorySyncProgress,
  type PathSyncSummary,
  syncCodexAuthFile,
  syncCodexConfigDir,
  syncGhConfigDir,
  syncOpenCodeAuthFile,
  syncOpenCodeConfigDir,
  type ToolingSyncSummary,
} from "../tooling/host-sandbox-sync.js";

const TOOLING_SYNC_PROGRESS_LOG_INTERVAL = 50;

export async function syncToolingForMode(
  config: Awaited<ReturnType<typeof loadConfig>>,
  sandbox: Pick<SandboxHandle, "writeFile">,
  _mode: ConcreteStartupMode,
): Promise<ToolingSyncSummary> {
  const ghConfig = await maybeSyncGhConfig(config, sandbox);

  const opencodeConfig = await runSyncUnit("OpenCode config", (onProgress) =>
    syncOpenCodeConfigDir(config, sandbox, { onProgress }),
  );
  const opencodeAuth = await runSyncUnit("OpenCode auth", () => syncOpenCodeAuthFile(config, sandbox));
  const codexConfig = await runSyncUnit("Codex config", (onProgress) =>
    syncCodexConfigDir(config, sandbox, { onProgress }),
  );
  const codexAuth = await runSyncUnit("Codex auth", () => syncCodexAuthFile(config, sandbox));
  return summarizeToolingSync(opencodeConfig, opencodeAuth, codexConfig, codexAuth, ghConfig, config.gh.enabled);
}

async function maybeSyncGhConfig(
  config: Awaited<ReturnType<typeof loadConfig>>,
  sandbox: Pick<SandboxHandle, "writeFile">,
): Promise<PathSyncSummary | null> {
  if (!config.gh.enabled) {
    return null;
  }

  return runSyncUnit("GitHub CLI config", (onProgress) => syncGhConfigDir(config, sandbox, { onProgress }));
}

async function runSyncUnit(
  label: string,
  syncUnit: (onProgress?: (progress: DirectorySyncProgress) => void) => Promise<PathSyncSummary>,
): Promise<PathSyncSummary> {
  let lastLoggedCount = 0;
  const onProgress = (progress: DirectorySyncProgress): void => {
    if (progress.filesDiscovered === 0) {
      return;
    }

    const processedCount = progress.filesWritten + progress.filesUnchanged;
    const isCompletion = processedCount === progress.filesDiscovered;
    const reachedInterval = progress.filesWritten - lastLoggedCount >= TOOLING_SYNC_PROGRESS_LOG_INTERVAL;
    if (!isCompletion && !reachedInterval) {
      return;
    }

    lastLoggedCount = progress.filesWritten;
    logger.verbose(
      `Tooling sync progress: ${label} ${processedCount}/${progress.filesDiscovered} (written=${progress.filesWritten}, unchanged=${progress.filesUnchanged})`,
    );
  };

  logger.verbose(`Tooling sync start: ${label}.`);
  const summary = await syncUnit(onProgress);
  logger.verbose(
    `Tooling sync done: ${label} discovered=${summary.filesDiscovered}, written=${summary.filesWritten}, unchanged=${summary.filesUnchanged}, skippedMissing=${summary.skippedMissing}.`,
  );
  return summary;
}

function summarizeToolingSync(
  opencodeConfig: PathSyncSummary | null,
  opencodeAuth: PathSyncSummary | null,
  codexConfig: PathSyncSummary | null,
  codexAuth: PathSyncSummary | null,
  ghConfig: PathSyncSummary | null,
  ghEnabled: boolean,
): ToolingSyncSummary {
  const summaries = [opencodeConfig, opencodeAuth, codexConfig, codexAuth, ghConfig].filter(
    (item): item is PathSyncSummary => item !== null,
  );

  return {
    totalDiscovered: summaries.reduce((total, item) => total + item.filesDiscovered, 0),
    totalWritten: summaries.reduce((total, item) => total + item.filesWritten, 0),
    totalUnchanged: summaries.reduce((total, item) => total + item.filesUnchanged, 0),
    totalMissingPaths: summaries.reduce((total, item) => total + Number(item.skippedMissing), 0),
    skippedMissingPaths: summaries.reduce((total, item) => total + Number(item.skippedMissing), 0),
    opencodeConfigSynced: opencodeConfig !== null && !opencodeConfig.skippedMissing,
    opencodeAuthSynced: opencodeAuth !== null && !opencodeAuth.skippedMissing,
    codexConfigSynced: codexConfig !== null && !codexConfig.skippedMissing,
    codexAuthSynced: codexAuth !== null && !codexAuth.skippedMissing,
    ghEnabled,
    ghConfigSynced: ghConfig !== null && !ghConfig.skippedMissing,
  };
}

export function formatToolingSyncSummary(summary: ToolingSyncSummary): string {
  const opencodeSynced = summary.opencodeConfigSynced || summary.opencodeAuthSynced;
  const codexSynced = summary.codexConfigSynced || summary.codexAuthSynced;
  const ghSynced = summary.ghEnabled && summary.ghConfigSynced;
  return `discovered=${summary.totalDiscovered}, written=${summary.totalWritten}, unchanged=${summary.totalUnchanged}, missingPaths=${summary.totalMissingPaths}, opencodeSynced=${opencodeSynced}, codexSynced=${codexSynced}, ghSynced=${ghSynced}`;
}
