import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import { createHash } from "node:crypto";
import type { ResolvedLauncherConfig } from "../config/schema.js";
import type { SandboxHandle } from "../e2b/lifecycle.js";

const OPEN_CODE_CONFIG_DEST = "/home/user/.config/opencode";
const OPEN_CODE_AUTH_DEST = "/home/user/.local/share/opencode/auth.json";
const CODEX_CONFIG_DEST = "/home/user/.codex";
const CODEX_AUTH_DEST = "/home/user/.codex/auth.json";
const GH_CONFIG_DEST = "/home/user/.config/gh";

const SKIPPED_DIRECTORY_NAMES = new Set([
  "archived_sessions",
  "sessions",
  "logs",
  "log",
  "cache",
  ".cache",
  "tmp",
  "temp",
  "node_modules",
  ".git",
  "vendor_imports",
  "shell_snapshots",
  "sqlite",
  ".system",
  ".curated"
]);

const SKIPPED_FILE_EXTENSIONS = new Set([".jsonl", ".log", ".tmp", ".swp", ".db", ".sqlite"]);
const SKIPPED_FILE_NAMES = new Set([".DS_Store", ".codex-global-state.json", "models_cache.json"]);
const GH_SKIPPED_SYNC_FILE_NAMES = new Set(["hosts.yml"]);

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
  ghEnabled: boolean;
  ghConfigSynced: boolean;
}

type ToolingSyncConfig = Pick<ResolvedLauncherConfig, "opencode" | "codex" | "gh">;
type SandboxWritableHandle = Pick<SandboxHandle, "writeFile">;

const SANDBOX_SYNC_CACHE = new WeakMap<SandboxWritableHandle, Map<string, string>>();

export function resolveHostPath(inputPath: string, options: HostPathResolveOptions = {}): string {
  const homeDir = options.homeDir ?? process.env.HOME ?? homedir();
  const cwd = options.cwd ?? process.cwd();

  let expanded = inputPath.replaceAll("${HOME}", homeDir).replaceAll("$HOME", homeDir);
  if (expanded === "~") {
    expanded = homeDir;
  } else if (expanded.startsWith("~/")) {
    expanded = join(homeDir, expanded.slice(2));
  }

  return isAbsolute(expanded) ? resolve(expanded) : resolve(cwd, expanded);
}

export async function discoverDirectoryFiles(rootPath: string): Promise<string[]> {
  const foundFiles: string[] = [];

  await walkDirectory(rootPath, foundFiles);
  return foundFiles;
}

export async function syncOpenCodeConfigDir(
  config: ToolingSyncConfig,
  sandbox: Pick<SandboxHandle, "writeFile">,
  options?: HostToSandboxSyncOptions
): Promise<PathSyncSummary> {
  return syncDirectory(config.opencode.config_dir, OPEN_CODE_CONFIG_DEST, sandbox, options);
}

export async function syncOpenCodeAuthFile(
  config: ToolingSyncConfig,
  sandbox: Pick<SandboxHandle, "writeFile">,
  options?: HostToSandboxSyncOptions
): Promise<PathSyncSummary> {
  return syncFile(config.opencode.auth_path, OPEN_CODE_AUTH_DEST, sandbox, options);
}

export async function syncCodexConfigDir(
  config: ToolingSyncConfig,
  sandbox: Pick<SandboxHandle, "writeFile">,
  options?: HostToSandboxSyncOptions
): Promise<PathSyncSummary> {
  return syncDirectory(config.codex.config_dir, CODEX_CONFIG_DEST, sandbox, options);
}

export async function syncCodexAuthFile(
  config: ToolingSyncConfig,
  sandbox: Pick<SandboxHandle, "writeFile">,
  options?: HostToSandboxSyncOptions
): Promise<PathSyncSummary> {
  return syncFile(config.codex.auth_path, CODEX_AUTH_DEST, sandbox, options);
}

export async function syncGhConfigDir(
  config: ToolingSyncConfig,
  sandbox: Pick<SandboxHandle, "writeFile">,
  options?: HostToSandboxSyncOptions
): Promise<PathSyncSummary> {
  return syncDirectory(config.gh.config_dir, GH_CONFIG_DEST, sandbox, {
    ...options,
    skipFileNames: GH_SKIPPED_SYNC_FILE_NAMES
  });
}

export async function syncToolingToSandbox(
  config: ToolingSyncConfig,
  sandbox: SandboxWritableHandle,
  options?: HostToSandboxSyncOptions
): Promise<ToolingSyncSummary> {
  const opencodeConfig = await syncOpenCodeConfigDir(config, sandbox, options);
  const opencodeAuth = await syncOpenCodeAuthFile(config, sandbox, options);
  const codexConfig = await syncCodexConfigDir(config, sandbox, options);
  const codexAuth = await syncCodexAuthFile(config, sandbox, options);
  const ghConfig = config.gh.enabled ? await syncGhConfigDir(config, sandbox, options) : null;

  const summaries = [opencodeConfig, opencodeAuth, codexConfig, codexAuth, ghConfig].filter(
    (item): item is PathSyncSummary => item !== null
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
    ghEnabled: config.gh.enabled,
    ghConfigSynced: ghConfig !== null && !ghConfig.skippedMissing
  };
}

async function syncDirectory(
  localDirectoryPath: string,
  sandboxDirectoryPath: string,
  sandbox: SandboxWritableHandle,
  options?: DirectorySyncOptions
): Promise<PathSyncSummary> {
  const resolvedLocalDirectoryPath = resolveHostPath(localDirectoryPath, options);
  const syncState = getSandboxSyncState(sandbox);
  if (!(await pathExists(resolvedLocalDirectoryPath))) {
    pruneSandboxPrefix(syncState, ensureDirectoryPrefix(sandboxDirectoryPath), new Set());
    return {
      skippedMissing: true,
      filesDiscovered: 0,
      filesWritten: 0,
      filesUnchanged: 0
    };
  }

  const discoveredFiles = await discoverDirectoryFiles(resolvedLocalDirectoryPath);
  const files = discoveredFiles.filter((filePath) => !shouldSkipSyncFile(filePath, options));
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
        filesDiscovered: files.length
      });
    }
  }
  pruneSandboxPrefix(syncState, ensureDirectoryPrefix(sandboxDirectoryPath), syncedPaths);

  return {
    skippedMissing: false,
    filesDiscovered: files.length,
    filesWritten,
    filesUnchanged
  };
}

function shouldSkipSyncFile(filePath: string, options?: DirectorySyncOptions): boolean {
  if (!options?.skipFileNames) {
    return false;
  }

  return options.skipFileNames.has(basename(filePath).toLowerCase());
}

async function syncFile(
  localFilePath: string,
  sandboxFilePath: string,
  sandbox: SandboxWritableHandle,
  options?: HostToSandboxSyncOptions
): Promise<PathSyncSummary> {
  const resolvedLocalFilePath = resolveHostPath(localFilePath, options);
  const syncState = getSandboxSyncState(sandbox);
  if (!(await pathExists(resolvedLocalFilePath))) {
    syncState.delete(sandboxFilePath);
    return {
      skippedMissing: true,
      filesDiscovered: 0,
      filesWritten: 0,
      filesUnchanged: 0
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
    filesUnchanged
  };
}

async function pathExists(pathToCheck: string): Promise<boolean> {
  try {
    await stat(pathToCheck);
    return true;
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return false;
    }

    throw error;
  }
}

async function walkDirectory(rootPath: string, foundFiles: string[]): Promise<void> {
  const entries = await readdir(rootPath, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name));

  for (const entry of entries) {
    const fullPath = join(rootPath, entry.name);
    if (entry.isDirectory()) {
      if (shouldSkipDirectoryEntry(entry.name)) {
        continue;
      }

      await walkDirectory(fullPath, foundFiles);
      continue;
    }

    if (entry.isFile()) {
      if (shouldSkipFileEntry(entry.name)) {
        continue;
      }

      foundFiles.push(fullPath);
      continue;
    }

  }
}

function shouldSkipDirectoryEntry(name: string): boolean {
  return SKIPPED_DIRECTORY_NAMES.has(name.toLowerCase());
}

function shouldSkipFileEntry(name: string): boolean {
  if (SKIPPED_FILE_NAMES.has(name)) {
    return true;
  }

  const lowerCaseName = name.toLowerCase();
  for (const extension of SKIPPED_FILE_EXTENSIONS) {
    if (lowerCaseName.endsWith(extension)) {
      return true;
    }
  }

  return false;
}

function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return Uint8Array.from(data).buffer;
}

function digestBuffer(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function getSandboxSyncState(sandbox: SandboxWritableHandle): Map<string, string> {
  const existing = SANDBOX_SYNC_CACHE.get(sandbox);
  if (existing) {
    return existing;
  }

  const created = new Map<string, string>();
  SANDBOX_SYNC_CACHE.set(sandbox, created);
  return created;
}

function ensureDirectoryPrefix(path: string): string {
  return path.endsWith("/") ? path : `${path}/`;
}

function pruneSandboxPrefix(
  syncState: Map<string, string>,
  prefix: string,
  currentPaths: ReadonlySet<string>
): void {
  for (const key of syncState.keys()) {
    if (key.startsWith(prefix) && !currentPaths.has(key)) {
      syncState.delete(key);
    }
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
