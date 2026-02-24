import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { StartupMode } from "../types/index.js";

export interface LastRunState {
  sandboxId: string;
  mode: StartupMode;
  activeRepo?: string;
  updatedAt: string;
}

type LastRunStateJson = Partial<LastRunState>;

const DEFAULT_LAST_RUN_FILENAME = ".ez-devbox-last-run.json";
const LEGACY_LAST_RUN_FILENAME = ".agent-box-last-run.json";
const DEFAULT_LAST_RUN_DIR = join(tmpdir(), "ez-devbox", "last-run", "cwd-state");
const STARTUP_MODES: ReadonlySet<StartupMode> = new Set(["prompt", "ssh-opencode", "ssh-codex", "web", "ssh-shell"]);

export async function loadLastRunState(path?: string): Promise<LastRunState | null> {
  const { resolvedPath, usedDefaultPath } = resolveLastRunPath(path);
  const currentState = await loadLastRunStateFromPath(resolvedPath);
  if (currentState !== null) {
    return currentState;
  }

  const legacyFallbackPath = resolveLegacyFallbackPath(resolvedPath, usedDefaultPath);
  if (!legacyFallbackPath) {
    return null;
  }

  return loadLastRunStateFromPath(legacyFallbackPath);
}

async function loadLastRunStateFromPath(path: string): Promise<LastRunState | null> {
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (error) {
    if (isErrnoException(error) && error.code === "ENOENT") {
      return null;
    }

    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  return normalizeLastRunState(parsed);
}

export async function saveLastRunState(state: LastRunState, path?: string): Promise<void> {
  const { resolvedPath } = resolveLastRunPath(path);
  await mkdir(dirname(resolvedPath), { recursive: true });
  await writeFile(resolvedPath, JSON.stringify(state, null, 2), "utf8");
}

export async function clearLastRunState(path?: string): Promise<void> {
  const { resolvedPath } = resolveLastRunPath(path);
  await rm(resolvedPath, { force: true });
}

function resolveLastRunPath(path?: string): { resolvedPath: string; usedDefaultPath: boolean } {
  if (path !== undefined) {
    return { resolvedPath: resolve(path), usedDefaultPath: false };
  }

  return {
    resolvedPath: resolve(
      DEFAULT_LAST_RUN_DIR,
      createHash("sha1").update(process.cwd()).digest("hex"),
      DEFAULT_LAST_RUN_FILENAME
    ),
    usedDefaultPath: true
  };
}

function normalizeLastRunState(value: unknown): LastRunState | null {
  if (!isRecord(value)) {
    return null;
  }

  const payload = value as LastRunStateJson;
  if (typeof payload.sandboxId !== "string" || payload.sandboxId.trim() === "") {
    return null;
  }

  if (typeof payload.mode !== "string" || !STARTUP_MODES.has(payload.mode as StartupMode)) {
    return null;
  }

  if (typeof payload.updatedAt !== "string" || payload.updatedAt.trim() === "") {
    return null;
  }

  if (payload.activeRepo !== undefined && typeof payload.activeRepo !== "string") {
    return null;
  }

  return {
    sandboxId: payload.sandboxId,
    mode: payload.mode,
    activeRepo: payload.activeRepo,
    updatedAt: payload.updatedAt
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
}

function resolveLegacyFallbackPath(path: string, fromDefaultPath: boolean): string | null {
  if (fromDefaultPath) {
    return resolve(process.cwd(), LEGACY_LAST_RUN_FILENAME);
  }

  if (basename(path) !== DEFAULT_LAST_RUN_FILENAME) {
    return null;
  }

  return join(dirname(path), LEGACY_LAST_RUN_FILENAME);
}
