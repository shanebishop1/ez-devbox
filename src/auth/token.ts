const tokenEnvPriority = ["GITHUB_TOKEN", "GH_TOKEN"] as const;

export type GitTokenSource = "env_github" | "env_gh" | "host" | "none";

export interface GitTokenResolution {
  token?: string;
  source: GitTokenSource;
}

export interface ResolveGitTokenOptions {
  resolveHostToken?: (env: NodeJS.ProcessEnv) => Promise<string | undefined> | string | undefined;
}

export async function resolveGitToken(
  env: NodeJS.ProcessEnv,
  options: ResolveGitTokenOptions = {}
): Promise<GitTokenResolution> {
  for (const key of tokenEnvPriority) {
    const value = normalizeValue(env[key]);
    if (value) {
      return {
        token: value,
        source: key === "GITHUB_TOKEN" ? "env_github" : "env_gh"
      };
    }
  }

  const hostToken = normalizeValue(await options.resolveHostToken?.(env));
  if (hostToken) {
    return {
      token: hostToken,
      source: "host"
    };
  }

  return {
    source: "none"
  };
}

function normalizeValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
