import type { SandboxHandle } from "../e2b/lifecycle.js";
import { logger } from "../logging/logger.js";
import type { LaunchContextOptions, ModeLaunchResult } from "./index.js";
import {
  buildInteractiveRemoteCommand,
  type SshModeDeps,
  cleanupSshBridgeSession,
  prepareSshBridgeSession,
  runInteractiveSshSession,
  stageInteractiveStartupEnv
} from "./ssh-bridge.js";

const SHELL_SMOKE_COMMAND = "bash -lc 'echo shell-ready'";
const COMMAND_TIMEOUT_MS = 15_000;

type ShellModeDeps = SshModeDeps;

const defaultDeps: ShellModeDeps = {
  isInteractiveTerminal: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
  prepareSession: prepareSshBridgeSession,
  runInteractiveSession: runInteractiveSshSession,
  cleanupSession: cleanupSshBridgeSession
};

export async function startShellMode(
  handle: SandboxHandle,
  launchContext: LaunchContextOptions = {},
  deps: ShellModeDeps = defaultDeps
): Promise<ModeLaunchResult> {
  const commandContext = resolveCommandContext(launchContext);

  if (!deps.isInteractiveTerminal()) {
    return runSmokeCheck(handle, commandContext);
  }

  logger.verbose("Preparing secure SSH bridge (first run may install packages).");
  const session = await deps.prepareSession(handle);

  try {
    const envScriptPath = await stageInteractiveStartupEnv(handle, session, commandContext.envs);
    logger.verbose("Opening interactive SSH session.");
    await deps.runInteractiveSession(
      session,
      buildInteractiveRemoteCommand({
        cwd: commandContext.cwd,
        envScriptPath,
        command: "bash -i"
      })
    );
  } finally {
    logger.verbose("Cleaning up interactive SSH session.");
    await deps.cleanupSession(handle, session);
  }

  return {
    mode: "ssh-shell",
    command: "bash",
    details: {
      session: "interactive",
      status: "completed"
    },
    message: `Shell interactive session ended for sandbox ${handle.sandboxId}`
  };
}

async function runSmokeCheck(
  handle: SandboxHandle,
  commandContext: { cwd?: string; envs: Record<string, string> }
): Promise<ModeLaunchResult> {
  const result = await handle.run(SHELL_SMOKE_COMMAND, {
    ...(commandContext.cwd ? { cwd: commandContext.cwd } : {}),
    ...(Object.keys(commandContext.envs).length > 0 ? { envs: commandContext.envs } : {}),
    timeoutMs: COMMAND_TIMEOUT_MS
  });

  const output = result.stdout.trim() || "no output";

  return {
    mode: "ssh-shell",
    command: SHELL_SMOKE_COMMAND,
    details: {
      smoke: "shell",
      status: output === "shell-ready" ? "ready" : "unexpected-output",
      output
    },
    message: `Shell smoke check in sandbox ${handle.sandboxId}: ${output}`
  };
}

function resolveCommandContext(launchContext: LaunchContextOptions): { cwd?: string; envs: Record<string, string> } {
  return {
    cwd: normalizeOptionalValue(launchContext.workingDirectory),
    envs: launchContext.startupEnv ?? {}
  };
}

function normalizeOptionalValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
