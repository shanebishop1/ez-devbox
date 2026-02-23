import type { ResolvedLauncherConfig } from "../config/schema.js";

type FirecrawlConfig = Pick<ResolvedLauncherConfig, "mcp">;
type FirecrawlEnv = Record<string, string | undefined>;

export interface FirecrawlEnvResolution {
  envs: Record<string, string>;
  warnings: string[];
}

export function resolveFirecrawlEnv(config: FirecrawlConfig, env: FirecrawlEnv): FirecrawlEnvResolution {
  const mode = config.mcp.mode;
  const url = getEffectiveFirecrawlUrl(config, env);
  const apiKey = trimToUndefined(env.FIRECRAWL_API_KEY);

  if (mode === "disabled") {
    return { envs: {}, warnings: [] };
  }

  if (mode === "remote_url") {
    const { url: validatedUrl, warnings } = validateRemoteUrl(config, url);
    const envs: Record<string, string> = {
      FIRECRAWL_API_URL: validatedUrl
    };

    if (apiKey !== undefined) {
      envs.FIRECRAWL_API_KEY = apiKey;
    }

    return { envs, warnings };
  }

  if (url === undefined) {
    return {
      envs: {},
      warnings: [
        "mcp.mode='in_sandbox' is advanced and not fully implemented yet. Provide mcp.firecrawl_api_url or FIRECRAWL_API_URL to use a known remote endpoint."
      ]
    };
  }

  const envs: Record<string, string> = {
    FIRECRAWL_API_URL: url
  };

  if (apiKey !== undefined) {
    envs.FIRECRAWL_API_KEY = apiKey;
  }

  return { envs, warnings: [] };
}

export function validateFirecrawlPreflight(config: FirecrawlConfig, env: FirecrawlEnv): void {
  resolveFirecrawlEnv(config, env);
}

function getEffectiveFirecrawlUrl(config: FirecrawlConfig, env: FirecrawlEnv): string | undefined {
  const configUrl = trimToUndefined(config.mcp.firecrawl_api_url);
  if (configUrl !== undefined) {
    return configUrl;
  }

  return trimToUndefined(env.FIRECRAWL_API_URL);
}

function validateRemoteUrl(config: FirecrawlConfig, url: string | undefined): { url: string; warnings: string[] } {
  if (url === undefined) {
    throw new Error(
      "mcp.mode='remote_url' requires a reachable Firecrawl URL. Set mcp.firecrawl_api_url in launcher.config.toml or FIRECRAWL_API_URL in your environment."
    );
  }

  if (!isValidHttpUrl(url)) {
    throw new Error(
      `Invalid Firecrawl URL '${url}'. Use a full http(s) URL such as 'https://firecrawl.example.com'.`
    );
  }

  if (isLocalhostUrl(url)) {
    if (!config.mcp.allow_localhost_override) {
      throw new Error(
        `Firecrawl URL '${url}' points to localhost and is not reachable from remote E2B sandboxes. Use a public/tunneled URL or set mcp.allow_localhost_override=true if you intentionally accept this risk.`
      );
    }

    return {
      url,
      warnings: [
        "Using localhost Firecrawl URL for mcp.mode='remote_url' via allow_localhost_override=true; this is not reachable from remote E2B sandboxes unless you provide tunnel/routing."
      ]
    };
  }

  return { url, warnings: [] };
}

function trimToUndefined(value: string | undefined): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function isValidHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function isLocalhostUrl(value: string): boolean {
  const hostname = new URL(value).hostname.toLowerCase();
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0";
}
