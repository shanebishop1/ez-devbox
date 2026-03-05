export function applyEnvDefaults(targetEnv: NodeJS.ProcessEnv, envSource: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(envSource)) {
    if (targetEnv[key] === undefined && value !== undefined) {
      targetEnv[key] = value;
    }
  }
}
