import { rm } from "node:fs/promises";
import type { SandboxHandle } from "../e2b/lifecycle.js";
import { SSH_SHORT_TIMEOUT_MS } from "./ssh-bridge.constants.js";
import type { SshBridgeSession } from "./ssh-bridge.types.js";
import { quoteShellArg } from "./ssh-bridge.utils.js";

export async function cleanupSshBridgeSession(handle: SandboxHandle, session: SshBridgeSession): Promise<void> {
  const artifacts = session.artifacts;

  if (artifacts) {
    const removePaths = [
      artifacts.authorizedKeysPath,
      artifacts.hostPrivateKeyPath,
      artifacts.hostPublicKeyPath,
      artifacts.sshdConfigPath,
      artifacts.websockifyLogPath,
      artifacts.websockifyPidPath,
      artifacts.sshdPidPath,
    ];

    if (session.startupEnvScriptPath) {
      removePaths.push(session.startupEnvScriptPath);
    }

    await runBestEffortRemoteCleanup(
      handle,
      `if [ -f ${quoteShellArg(artifacts.websockifyPidPath)} ]; then pid=$(cat ${quoteShellArg(artifacts.websockifyPidPath)}); if [ -n "$pid" ]; then kill "$pid" >/dev/null 2>&1 || true; fi; fi`,
    );
    await runBestEffortRemoteCleanup(
      handle,
      `if [ -f ${quoteShellArg(artifacts.sshdPidPath)} ]; then pid=$(cat ${quoteShellArg(artifacts.sshdPidPath)}); if [ -n "$pid" ]; then sudo kill "$pid" >/dev/null 2>&1 || true; fi; fi`,
    );
    await runBestEffortRemoteCleanup(
      handle,
      `for path in ${removePaths.map(quoteShellArg).join(" ")} ; do rm -f "$path"; done; rm -rf ${quoteShellArg(artifacts.sessionDir)}`,
    );
  }

  await runBestEffortLocalCleanup(session.tempDir);
}

export function resolveStartupEnvScriptPath(handle: SandboxHandle, session: SshBridgeSession): string {
  if (session.artifacts?.sessionDir) {
    return `${session.artifacts.sessionDir}/startup-env.sh`;
  }

  const random = Math.random().toString(16).slice(2, 10);
  return `/tmp/ez-devbox-startup-env-${handle.sandboxId}-${random}.sh`;
}

async function runBestEffortRemoteCleanup(handle: SandboxHandle, command: string): Promise<void> {
  try {
    await handle.run(command, { timeoutMs: SSH_SHORT_TIMEOUT_MS });
  } catch {
    // Ignore cleanup failures.
  }
}

async function runBestEffortLocalCleanup(tempDir: string): Promise<void> {
  try {
    await rm(tempDir, {
      recursive: true,
      force: true,
    });
  } catch {
    // Ignore cleanup failures.
  }
}
