import { posix } from "node:path";
import type { SandboxHandle } from "../e2b/lifecycle.js";
import { logger } from "../logging/logger.js";
import { ENV_VAR_NAME_REGEX, SSH_SHORT_TIMEOUT_MS } from "./ssh-bridge.constants.js";
import { resolveStartupEnvScriptPath } from "./ssh-bridge.cleanup.js";
import type { SshBridgeSession } from "./ssh-bridge.types.js";
import { quoteShellArg } from "./ssh-bridge.utils.js";

export async function stageInteractiveStartupEnv(
  handle: SandboxHandle,
  session: SshBridgeSession,
  envs: Record<string, string>
): Promise<string | undefined> {
  const validEntries: Array<[string, string]> = [];

  for (const [key, value] of Object.entries(envs)) {
    if (!ENV_VAR_NAME_REGEX.test(key)) {
      logger.warn(`Skipping invalid startup env key for interactive session: ${key}`);
      continue;
    }
    validEntries.push([key, value]);
  }

  if (validEntries.length === 0) {
    return undefined;
  }

  const envScriptPath = resolveStartupEnvScriptPath(handle, session);
  const parentDir = posix.dirname(envScriptPath);
  const keys = validEntries.map(([key]) => quoteShellArg(key)).join(" ");
  const indirectExpansion = "${!key-}";

  await handle.run(
    `bash -lc 'set -euo pipefail; mkdir -p ${quoteShellArg(parentDir)}; umask 077; env_file=${quoteShellArg(
      envScriptPath
    )}; printf "%s\\n" "#!/usr/bin/env bash" > "$env_file"; for key in ${keys}; do value="${indirectExpansion}"; printf "export %s=%q\\n" "$key" "$value" >> "$env_file"; done; chmod 600 "$env_file"'`,
    {
      envs: Object.fromEntries(validEntries),
      timeoutMs: SSH_SHORT_TIMEOUT_MS
    }
  );

  session.startupEnvScriptPath = envScriptPath;
  return envScriptPath;
}
