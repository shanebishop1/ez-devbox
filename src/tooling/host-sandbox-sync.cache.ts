import { createHash } from "node:crypto";

type SandboxWritableHandle = {
  writeFile: (path: string, data: ArrayBuffer) => Promise<void>;
};

const SANDBOX_SYNC_CACHE = new WeakMap<SandboxWritableHandle, Map<string, string>>();

export function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return Uint8Array.from(data).buffer;
}

export function digestBuffer(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

export function getSandboxSyncState(sandbox: SandboxWritableHandle): Map<string, string> {
  const existing = SANDBOX_SYNC_CACHE.get(sandbox);
  if (existing) {
    return existing;
  }

  const created = new Map<string, string>();
  SANDBOX_SYNC_CACHE.set(sandbox, created);
  return created;
}

export function ensureDirectoryPrefix(path: string): string {
  return path.endsWith("/") ? path : `${path}/`;
}

export function pruneSandboxPrefix(
  syncState: Map<string, string>,
  prefix: string,
  currentPaths: ReadonlySet<string>,
): void {
  for (const key of syncState.keys()) {
    if (key.startsWith(prefix) && !currentPaths.has(key)) {
      syncState.delete(key);
    }
  }
}
