import { resolveHostGhToken } from "../auth/gh-host-token.js";
import type { loadConfig } from "../config/load.js";
import { logger } from "../logging/logger.js";

export async function resolveGhRuntimeEnv(
  config: Awaited<ReturnType<typeof loadConfig>>,
  envSource: Record<string, string | undefined>,
  resolveToken?: (env: NodeJS.ProcessEnv) => Promise<string | undefined>,
): Promise<Record<string, string>> {
  if (!config.gh.enabled) {
    return {};
  }

  logger.verbose("GitHub auth: resolving token.");
  const resolver = resolveToken ?? resolveHostGhToken;
  const token = await resolver(envSource);
  if (!token) {
    logger.verbose("GitHub auth: token not found; continuing without GH_TOKEN/GITHUB_TOKEN.");
    return {};
  }

  logger.verbose("GitHub auth: token found; injecting GH_TOKEN/GITHUB_TOKEN.");
  return {
    GH_TOKEN: token,
    GITHUB_TOKEN: token,
  };
}
