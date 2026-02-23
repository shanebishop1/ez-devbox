import type { ResolvedLauncherConfig } from "../config/schema.js";
import { resolveFirecrawlEnv } from "../mcp/firecrawl.js";

type EnvSource = Record<string, string | undefined>;

const BUILTIN_PASSTHROUGH_VARS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "GITHUB_TOKEN",
  "GH_TOKEN",
  "OPENCODE_SERVER_PASSWORD",
  "FIRECRAWL_API_KEY",
  "FIRECRAWL_API_URL"
] as const;

export interface SandboxCreateEnvResolution {
  envs: Record<string, string>;
  warnings: string[];
}

export function resolveSandboxCreateEnv(
  config: Pick<ResolvedLauncherConfig, "env" | "mcp">,
  envSource: EnvSource = process.env
): SandboxCreateEnvResolution {
  const resolved: Record<string, string> = {};
  const allowlist = new Set<string>([...config.env.pass_through, ...BUILTIN_PASSTHROUGH_VARS]);

  for (const key of allowlist) {
    const value = trimToUndefined(envSource[key]);
    if (value !== undefined) {
      resolved[key] = value;
    }
  }

  const firecrawl = resolveFirecrawlEnv(config, envSource);

  return {
    envs: {
      ...resolved,
      ...firecrawl.envs
    },
    warnings: firecrawl.warnings
  };
}

function trimToUndefined(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}
