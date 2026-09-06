import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { extname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";
import type { SandboxHandle } from "../e2b/lifecycle.js";
import { logger } from "../logging/logger.js";
import {
  digestBuffer,
  ensureDirectoryPrefix,
  getSandboxSyncState,
  pruneSandboxPrefix,
  toArrayBuffer,
} from "./host-sandbox-sync.cache.js";
import { UNSUPPORTED_SYNC_FILE_EXTENSIONS } from "./host-sandbox-sync.constants.js";
import { discoverDirectoryFiles, pathExists, shouldSkipSyncFile } from "./host-sandbox-sync.fs.js";
import {
  restrictSandboxDirectoryPermissions,
  restrictSandboxFilePermissions,
} from "./host-sandbox-sync.permissions.js";

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

type SandboxWritableHandle = Pick<SandboxHandle, "writeFile"> & Partial<Pick<SandboxHandle, "run">>;

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

export async function syncDirectory(
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
  if (files.length > 0) {
    await restrictSandboxDirectoryPermissions(sandbox, sandboxDirectoryPath);
  }

  return {
    skippedMissing: false,
    filesDiscovered: files.length,
    filesWritten,
    filesUnchanged,
  };
}

export async function syncFile(
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
  await restrictSandboxFilePermissions(sandbox, sandboxFilePath);

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
