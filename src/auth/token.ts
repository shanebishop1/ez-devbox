const tokenEnvPriority = ["GITHUB_TOKEN", "GH_TOKEN"] as const;

export function resolveGitToken(env: NodeJS.ProcessEnv): string | undefined {
  for (const key of tokenEnvPriority) {
    const value = env[key];
    if (value) {
      return value;
    }
  }

  return undefined;
}
