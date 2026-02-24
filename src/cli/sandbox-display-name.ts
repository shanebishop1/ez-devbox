import type { StartupMode } from "../types/index.js";

const SANDBOX_NAME_METADATA_KEY = "launcher.name";

export function buildSandboxDisplayName(baseName: string, startupMode: StartupMode, timestamp: string): string {
  const normalizedBaseName = baseName.trim() === "" ? "sandbox" : baseName.trim();
  const normalizedMode = startupMode.replaceAll("-", " ");
  const normalizedTimestamp = formatTimestamp(timestamp);
  return `${normalizedBaseName} ${normalizedMode} ${normalizedTimestamp}`;
}

export function resolveSandboxDisplayName(metadata: Record<string, string> | undefined, sandboxId: string): string {
  const metadataName = metadata?.[SANDBOX_NAME_METADATA_KEY]?.trim();
  return metadataName && metadataName !== "" ? metadataName : sandboxId;
}

export function formatSandboxDisplayLabel(sandboxId: string, metadata?: Record<string, string>): string {
  const name = metadata?.[SANDBOX_NAME_METADATA_KEY]?.trim();
  if (!name) {
    return sandboxId;
  }

  return `${name} (${sandboxId})`;
}

function formatTimestamp(timestamp: string): string {
  const parsed = new Date(timestamp);
  if (Number.isNaN(parsed.getTime())) {
    return timestamp.trim() === "" ? "unknown-time" : timestamp.trim();
  }

  return parsed.toISOString().replace("T", " ").replace(/\.\d{3}Z$/, " UTC");
}
