import type { ResolvedProjectRepoConfig } from "../config/schema.js";

const SANDBOX_NAME_METADATA_KEY = "launcher.name";

export function buildSandboxDisplayName(configuredRepos: ResolvedProjectRepoConfig[], timestamp: string): string {
  const normalizedTimestamp = formatTimestamp(timestamp);

  if (configuredRepos.length === 1) {
    const repo = configuredRepos[0];
    return `${repo.name} ${repo.branch} ${normalizedTimestamp}`;
  }

  return normalizedTimestamp;
}

export function resolveSandboxDisplayName(metadata: Record<string, string> | undefined, sandboxId: string): string {
  const metadataName = sanitizeTerminalText(metadata?.[SANDBOX_NAME_METADATA_KEY] ?? "").trim();
  return metadataName !== "" ? metadataName : sanitizeTerminalText(sandboxId);
}

export function formatSandboxDisplayLabel(sandboxId: string, metadata?: Record<string, string>): string {
  const safeSandboxId = sanitizeTerminalText(sandboxId);
  const name = sanitizeTerminalText(metadata?.[SANDBOX_NAME_METADATA_KEY] ?? "").trim();
  if (!name) {
    return safeSandboxId;
  }

  return `${name} (${safeSandboxId})`;
}

function sanitizeTerminalText(value: string): string {
  return [...value]
    .filter((character) => {
      const codePoint = character.codePointAt(0) ?? 0;
      return codePoint >= 0x20 && codePoint !== 0x7f && (codePoint < 0x80 || codePoint > 0x9f);
    })
    .join("");
}

function formatTimestamp(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return timestamp.trim() === "" ? "unknown-time" : timestamp.trim();
  }

  return parsed
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, " UTC");
}
