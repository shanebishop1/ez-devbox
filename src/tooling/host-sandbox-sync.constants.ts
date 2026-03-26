export const OPEN_CODE_CONFIG_DEST = "/home/user/.config/opencode";
export const OPEN_CODE_AUTH_DEST = "/home/user/.local/share/opencode/auth.json";
export const CODEX_CONFIG_DEST = "/home/user/.codex";
export const CODEX_AUTH_DEST = "/home/user/.codex/auth.json";
export const CLAUDE_CONFIG_DEST = "/home/user/.claude";
export const CLAUDE_STATE_DEST = "/home/user/.claude.json";
export const GH_CONFIG_DEST = "/home/user/.config/gh";

export const SKIPPED_DIRECTORY_NAMES = new Set([
  "archived_sessions",
  "sessions",
  "projects",
  "logs",
  "log",
  "cache",
  ".cache",
  "downloads",
  "tmp",
  "temp",
  "node_modules",
  ".git",
  "vendor_imports",
  "shell_snapshots",
  "shell-snapshots",
  "session-env",
  "telemetry",
  "statsig",
  "debug",
  "todos",
  "sqlite",
  ".system",
  ".curated",
]);

export const SKIPPED_FILE_EXTENSIONS = new Set([
  ".jsonl",
  ".log",
  ".tmp",
  ".swp",
  ".db",
  ".sqlite",
  ".sqlite-wal",
  ".sqlite-shm",
  ".sqlite-journal",
  ".db-wal",
  ".db-shm",
  ".db-journal",
]);
export const SKIPPED_FILE_NAMES = new Set([
  ".DS_Store",
  ".codex-global-state.json",
  "models_cache.json",
  "bun.lock",
  "bun.lockb",
]);
export const UNSUPPORTED_SYNC_FILE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".bmp",
  ".ico",
  ".tif",
  ".tiff",
]);
export const GH_SKIPPED_SYNC_FILE_NAMES = new Set(["hosts.yml"]);
