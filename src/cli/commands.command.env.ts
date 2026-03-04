const OPENCODE_SERVER_PASSWORD_ENV_VAR = "OPENCODE_SERVER_PASSWORD";

export function withoutOpenCodeServerPassword(envs: Record<string, string>): Record<string, string> {
  const { [OPENCODE_SERVER_PASSWORD_ENV_VAR]: _ignored, ...rest } = envs;
  return rest;
}
