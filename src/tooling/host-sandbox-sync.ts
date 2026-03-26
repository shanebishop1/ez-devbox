import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import type { ResolvedLauncherConfig } from "../config/schema.js";
import type { SandboxHandle } from "../e2b/lifecycle.js";
import { logger } from "../logging/logger.js";
import {
  digestBuffer,
  ensureDirectoryPrefix,
  getSandboxSyncState,
  pruneSandboxPrefix,
  toArrayBuffer,
} from "./host-sandbox-sync.cache.js";
import {
  CLAUDE_CONFIG_DEST,
  CLAUDE_STATE_DEST,
  CODEX_AUTH_DEST,
  CODEX_CONFIG_DEST,
  GH_CONFIG_DEST,
  GH_SKIPPED_SYNC_FILE_NAMES,
  OPEN_CODE_AUTH_DEST,
  OPEN_CODE_CONFIG_DEST,
  UNSUPPORTED_SYNC_FILE_EXTENSIONS,
} from "./host-sandbox-sync.constants.js";
import { discoverDirectoryFiles, pathExists, shouldSkipSyncFile } from "./host-sandbox-sync.fs.js";

export interface HostPathResolveOptions {
  homeDir?: string;
  cwd?: string;
}

export interface PathSyncSummary {
  skippedMissing: boolean;
  filesDiscovered: number;
  filesWritten: number;
  filesUnchanged: number;
}

export interface DirectorySyncProgress {
  filesWritten: number;
  filesUnchanged: number;
  filesDiscovered: number;
}

export interface HostToSandboxSyncOptions extends HostPathResolveOptions {
  onProgress?: (progress: DirectorySyncProgress) => void | Promise<void>;
}

interface DirectorySyncOptions extends HostToSandboxSyncOptions {
  skipFileNames?: ReadonlySet<string>;
}

export interface ToolingSyncSummary {
  totalDiscovered: number;
  totalWritten: number;
  totalUnchanged: number;
  totalMissingPaths: number;
  skippedMissingPaths: number;
  opencodeConfigSynced: boolean;
  opencodeAuthSynced: boolean;
  codexConfigSynced: boolean;
  codexAuthSynced: boolean;
  claudeConfigSynced: boolean;
  claudeStateSynced: boolean;
  ghEnabled: boolean;
  ghConfigSynced: boolean;
}

type ToolingSyncConfig = Pick<ResolvedLauncherConfig, "opencode" | "codex" | "claude" | "gh">;
type SandboxWritableHandle = Pick<SandboxHandle, "writeFile">;

export function resolveHostPath(inputPath: string, options: HostPathResolveOptions = {}): string {
  const homeDir = options.homeDir ?? process.env.HOME ?? homedir();
  const cwd = options.cwd ?? process.cwd();
  const homePlaceholder = "$" + "{HOME}";

  let expanded = inputPath.replaceAll(homePlaceholder, homeDir).replaceAll("$HOME", homeDir);
  if (expanded === "~") {
    expanded = homeDir;
  } else if (expanded.startsWith("~/")) {
    expanded = join(homeDir, expanded.slice(2));
  }

  return isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
}

export async function syncOpenCodeConfigDir(
  config: ToolingSyncConfig,
  sandbox: Pick<SandboxHandle, "writeFile">,
  options?: HostToSandboxSyncOptions,
): Promise<PathSyncSummary> {
  return syncDirectory(config.opencode.config_dir, OPEN_CODE_CONFIG_DEST, sandbox, options);
}

export async function syncOpenCodeAuthFile(
  config: ToolingSyncConfig,
  sandbox: Pick<SandboxHandle, "writeFile">,
  options?: HostToSandboxSyncOptions,
): Promise<PathSyncSummary> {
  return syncFile(config.opencode.auth_path, OPEN_CODE_AUTH_DEST, sandbox, options);
}

export async function syncCodexConfigDir(
  config: ToolingSyncConfig,
  sandbox: Pick<SandboxHandle, "writeFile">,
  options?: HostToSandboxSyncOptions,
): Promise<PathSyncSummary> {
  return syncDirectory(config.codex.config_dir, CODEX_CONFIG_DEST, sandbox, options);
}

export async function syncCodexAuthFile(
  config: ToolingSyncConfig,
  sandbox: Pick<SandboxHandle, "writeFile">,
  options?: HostToSandboxSyncOptions,
): Promise<PathSyncSummary> {
  return syncFile(config.codex.auth_path, CODEX_AUTH_DEST, sandbox, options);
}

export async function syncClaudeConfigDir(
  config: ToolingSyncConfig,
  sandbox: Pick<SandboxHandle, "writeFile">,
  options?: HostToSandboxSyncOptions,
): Promise<PathSyncSummary> {
  return syncDirectory(config.claude.config_dir, CLAUDE_CONFIG_DEST, sandbox, options);
}

export async function syncClaudeStateFile(
  config: ToolingSyncConfig,
  sandbox: Pick<SandboxHandle, "writeFile">,
  options?: HostToSandboxSyncOptions,
): Promise<PathSyncSummary> {
  return syncFile(config.claude.state_path, CLAUDE_STATE_DEST, sandbox, options);
}

export async function syncGhConfigDir(
  config: ToolingSyncConfig,
  sandbox: Pick<SandboxHandle, "writeFile">,
  options?: HostToSandboxSyncOptions,
): Promise<PathSyncSummary> {
  return syncDirectory(config.gh.config_dir, GH_CONFIG_DEST, sandbox, {
    ...options,
    skipFileNames: GH_SKIPPED_SYNC_FILE_NAMES,
  });
}

export async function syncToolingToSandbox(
  config: ToolingSyncConfig,
  sandbox: SandboxWritableHandle,
  options?: HostToSandboxSyncOptions,
): Promise<ToolingSyncSummary> {
  const opencodeConfig = await syncOpenCodeConfigDir(config, sandbox, options);
  const opencodeAuth = await syncOpenCodeAuthFile(config, sandbox, options);
  const codexConfig = await syncCodexConfigDir(config, sandbox, options);
  const codexAuth = await syncCodexAuthFile(config, sandbox, options);
  const claudeConfig = await syncClaudeConfigDir(config, sandbox, options);
  const claudeState = await syncClaudeStateFile(config, sandbox, options);
  const ghConfig = config.gh.enabled ? await syncGhConfigDir(config, sandbox, options) : null;

  const summaries = [opencodeConfig, opencodeAuth, codexConfig, codexAuth, claudeConfig, claudeState, ghConfig].filter(
    (item): item is PathSyncSummary => item !== null,
  );
  return {
    totalDiscovered: summaries.reduce((total, item) => total + item.filesDiscovered, 0),
    totalWritten: summaries.reduce((total, item) => total + item.filesWritten, 0),
    totalUnchanged: summaries.reduce((total, item) => total + item.filesUnchanged, 0),
    totalMissingPaths: summaries.reduce((total, item) => total + Number(item.skippedMissing), 0),
    skippedMissingPaths: summaries.reduce((total, item) => total + Number(item.skippedMissing), 0),
    opencodeConfigSynced: !opencodeConfig.skippedMissing,
    opencodeAuthSynced: !opencodeAuth.skippedMissing,
    codexConfigSynced: !codexConfig.skippedMissing,
    codexAuthSynced: !codexAuth.skippedMissing,
    claudeConfigSynced: !claudeConfig.skippedMissing,
    claudeStateSynced: !claudeState.skippedMissing,
    ghEnabled: config.gh.enabled,
    ghConfigSynced: ghConfig !== null && !ghConfig.skippedMissing,
  };
}

async function syncDirectory(
  localDirectoryPath: string,
  sandboxDirectoryPath: string,
  sandbox: SandboxWritableHandle,
  options?: DirectorySyncOptions,
): Promise<PathSyncSummary> {
  const resolvedLocalDirectoryPath = resolveHostPath(localDirectoryPath, options);
  const syncState = getSandboxSyncState(sandbox);
  if (!(await pathExists(resolvedLocalDirectoryPath))) {
    pruneSandboxPrefix(syncState, ensureDirectoryPrefix(sandboxDirectoryPath), new Set());
    return {
      skippedMissing: true,
      filesDiscovered: 0,
      filesWritten: 0,
      filesUnchanged: 0,
    };
  }

  const discoveredFiles = await discoverDirectoryFiles(resolvedLocalDirectoryPath);
  const skippedUnsupportedExtensionCounts = new Map<string, number>();
  const files = discoveredFiles.filter((filePath) => {
    if (shouldSkipSyncFile(filePath, options)) {
      return false;
    }

    const fileExtension = extname(filePath).toLowerCase();
    if (UNSUPPORTED_SYNC_FILE_EXTENSIONS.has(fileExtension)) {
      skippedUnsupportedExtensionCounts.set(
        fileExtension,
        (skippedUnsupportedExtensionCounts.get(fileExtension) ?? 0) + 1,
      );
      return false;
    }

    return true;
  });
  if (skippedUnsupportedExtensionCounts.size > 0) {
    logger.warn(
      `Tooling sync skipped unsupported extensions in '${resolvedLocalDirectoryPath}': ${formatSkippedExtensionsSummary(skippedUnsupportedExtensionCounts)}`,
    );
  }
  let filesWritten = 0;
  let filesUnchanged = 0;
  const syncedPaths = new Set<string>();
  for (const absoluteFilePath of files) {
    const fileContent = await readFile(absoluteFilePath);
    const relativePath = relative(resolvedLocalDirectoryPath, absoluteFilePath).split(sep).join(posix.sep);
    const sandboxPath = posix.join(sandboxDirectoryPath, relativePath);
    syncedPaths.add(sandboxPath);
    const fileDigest = digestBuffer(fileContent);
    const previousDigest = syncState.get(sandboxPath);
    if (previousDigest === fileDigest) {
      filesUnchanged += 1;
    } else {
      await sandbox.writeFile(sandboxPath, toArrayBuffer(fileContent));
      syncState.set(sandboxPath, fileDigest);
      filesWritten += 1;
    }

    if (options?.onProgress) {
      await options.onProgress({
        filesWritten,
        filesUnchanged,
        filesDiscovered: files.length,
      });
    }
  }
  pruneSandboxPrefix(syncState, ensureDirectoryPrefix(sandboxDirectoryPath), syncedPaths);

  return {
    skippedMissing: false,
    filesDiscovered: files.length,
    filesWritten,
    filesUnchanged,
  };
}

async function syncFile(
  localFilePath: string,
  sandboxFilePath: string,
  sandbox: SandboxWritableHandle,
  options?: HostToSandboxSyncOptions,
): Promise<PathSyncSummary> {
  const resolvedLocalFilePath = resolveHostPath(localFilePath, options);
  const syncState = getSandboxSyncState(sandbox);
  if (!(await pathExists(resolvedLocalFilePath))) {
    syncState.delete(sandboxFilePath);
    return {
      skippedMissing: true,
      filesDiscovered: 0,
      filesWritten: 0,
      filesUnchanged: 0,
    };
  }

  const content = await readFile(resolvedLocalFilePath);
  const fileDigest = digestBuffer(content);
  const previousDigest = syncState.get(sandboxFilePath);
  let filesWritten = 0;
  let filesUnchanged = 0;
  if (previousDigest === fileDigest) {
    filesUnchanged = 1;
  } else {
    await sandbox.writeFile(sandboxFilePath, toArrayBuffer(content));
    syncState.set(sandboxFilePath, fileDigest);
    filesWritten = 1;
  }

  return {
    skippedMissing: false,
    filesDiscovered: 1,
    filesWritten,
    filesUnchanged,
  };
}

function formatSkippedExtensionsSummary(counts: Map<string, number>): string {
  return [...counts.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([extension, count]) => `${extension} (${count})`)
    .join(", ");
}

export { discoverDirectoryFiles };
