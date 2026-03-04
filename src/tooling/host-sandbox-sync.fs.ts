import { readdir, stat } from "node:fs/promises";
import { basename, join } from "node:path";
import { SKIPPED_DIRECTORY_NAMES, SKIPPED_FILE_EXTENSIONS, SKIPPED_FILE_NAMES } from "./host-sandbox-sync.constants.js";

export async function discoverDirectoryFiles(rootPath: string): Promise<string[]> {
  const foundFiles: string[] = [];

  await walkDirectory(rootPath, foundFiles);
  return foundFiles;
}

export function shouldSkipSyncFile(filePath: string, options?: { skipFileNames?: ReadonlySet<string> }): boolean {
  if (!options?.skipFileNames) {
    return false;
  }

  return options.skipFileNames.has(basename(filePath).toLowerCase());
}

export async function pathExists(pathToCheck: string): Promise<boolean> {
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error;
}
