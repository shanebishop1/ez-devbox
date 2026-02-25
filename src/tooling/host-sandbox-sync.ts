import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
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
}

export interface DirectorySyncProgress {
  filesWritten: number;
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
  skippedMissingPaths: number;
  opencodeConfigSynced: boolean;
  opencodeAuthSynced: boolean;
  codexConfigSynced: boolean;
  codexAuthSynced: boolean;
  ghEnabled: boolean;
  ghConfigSynced: boolean;
}

type ToolingSyncConfig = Pick<ResolvedLauncherConfig, "opencode" | "codex" | "gh">;

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
  sandbox: Pick<SandboxHandle, "writeFile">,
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
  sandbox: Pick<SandboxHandle, "writeFile">,
  options?: DirectorySyncOptions
): Promise<PathSyncSummary> {
  const resolvedLocalDirectoryPath = resolveHostPath(localDirectoryPath, options);
  if (!(await pathExists(resolvedLocalDirectoryPath))) {
    return {
      skippedMissing: true,
      filesDiscovered: 0,
      filesWritten: 0
    };
  }

  const discoveredFiles = await discoverDirectoryFiles(resolvedLocalDirectoryPath);
  const files = discoveredFiles.filter((filePath) => !shouldSkipSyncFile(filePath, options));
  let filesWritten = 0;
  for (const absoluteFilePath of files) {
    const fileContent = await readFile(absoluteFilePath);
    const relativePath = relative(resolvedLocalDirectoryPath, absoluteFilePath).split(sep).join(posix.sep);
    const sandboxPath = posix.join(sandboxDirectoryPath, relativePath);
    await sandbox.writeFile(sandboxPath, toArrayBuffer(fileContent));
    filesWritten += 1;

    if (options?.onProgress) {
      await options.onProgress({
        filesWritten,
        filesDiscovered: files.length
      });
    }
  }

  return {
    skippedMissing: false,
    filesDiscovered: files.length,
    filesWritten
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
  sandbox: Pick<SandboxHandle, "writeFile">,
  options?: HostToSandboxSyncOptions
): Promise<PathSyncSummary> {
  const resolvedLocalFilePath = resolveHostPath(localFilePath, options);
  if (!(await pathExists(resolvedLocalFilePath))) {
    return {
      skippedMissing: true,
      filesDiscovered: 0,
      filesWritten: 0
    };
  }

  const content = await readFile(resolvedLocalFilePath);
  await sandbox.writeFile(sandboxFilePath, toArrayBuffer(content));

  return {
    skippedMissing: false,
    filesDiscovered: 1,
    filesWritten: 1
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
