import type { ResolvedProjectRepoConfig } from "../config/schema.js";

const SANDBOX_NAME_METADATA_KEY = "launcher.name";

export function buildSandboxDisplayName(repos: ResolvedProjectRepoConfig[], timestamp: string): string {
  const normalizedTimestamp = formatTimestamp(timestamp);
  if (repos.length !== 1) {
    return normalizedTimestamp;
  }

  const [repo] = repos;
  const repoName = repo.name.trim() === "" ? "repo" : repo.name.trim();
  const branchName = repo.branch.trim() === "" ? "main" : repo.branch.trim();
  return `${repoName} ${branchName} ${normalizedTimestamp}`;
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
