import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { StartupMode } from "../types/index.js";

export interface LastRunState {
  sandboxId: string;
  mode: StartupMode;
  activeRepo?: string;
  updatedAt: string;
}

type LastRunStateJson = Partial<LastRunState>;

const DEFAULT_LAST_RUN_PATH = resolve(process.cwd(), ".agent-box-last-run.json");
const STARTUP_MODES: ReadonlySet<StartupMode> = new Set(["prompt", "ssh-opencode", "ssh-codex", "web", "ssh-shell"]);

export async function loadLastRunState(path = DEFAULT_LAST_RUN_PATH): Promise<LastRunState | null> {
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

export async function saveLastRunState(state: LastRunState, path = DEFAULT_LAST_RUN_PATH): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(state, null, 2), "utf8");
}

export async function clearLastRunState(path = DEFAULT_LAST_RUN_PATH): Promise<void> {
  await rm(path, { force: true });
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
