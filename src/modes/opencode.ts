import type { SandboxHandle } from "../e2b/lifecycle.js";
import { logger } from "../logging/logger.js";
import type { LaunchContextOptions, ModeLaunchResult } from "./index.js";
import {
  buildInteractiveRemoteCommand,
  cleanupSshBridgeSession,
  prepareSshBridgeSession,
  runInteractiveSshSession,
  type SshModeDeps,
  stageInteractiveStartupEnv,
} from "./ssh-bridge.js";

const OPEN_CODE_SMOKE_COMMAND = "opencode --version";
const OPEN_CODE_ATTACH_COMMAND = "opencode attach http://127.0.0.1:4096";
const OPEN_CODE_SERVER_BOOT_COMMAND =
  "nohup opencode serve --hostname 127.0.0.1 --port 4096 >/tmp/opencode-serve-ssh.log 2>&1 &";
const OPEN_CODE_SERVER_READINESS_COMMAND =
  'bash -lc \'for attempt in $(seq 1 30); do status=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4096/global/health || true); if [ "$status" = "200" ] || [ "$status" = "401" ]; then exit 0; fi; sleep 1; done; exit 1\'';
const OPEN_CODE_ATTACH_ORPHAN_CLEANUP_COMMAND =
  'bash -lc \'for pid in $(pgrep -u "$(whoami)" -f "[o]pencode attach http://127.0.0.1:4096" || true); do tty=$(ps -p "$pid" -o tty= | tr -d " "); if [ "$tty" = "?" ]; then kill "$pid" || true; fi; done\'';
const COMMAND_TIMEOUT_MS = 15_000;
const SERVER_START_TIMEOUT_MS = 10_000;
const SERVER_READY_TIMEOUT_MS = 35_000;
const ORPHAN_ATTACH_CLEANUP_TIMEOUT_MS = 10_000;

type OpenCodeModeDeps = SshModeDeps;

const defaultDeps: OpenCodeModeDeps = {
  isInteractiveTerminal: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
  prepareSession: prepareSshBridgeSession,
  runInteractiveSession: runInteractiveSshSession,
  cleanupSession: cleanupSshBridgeSession,
};

export async function startOpenCodeMode(
  handle: SandboxHandle,
  launchContext: LaunchContextOptions = {},
  deps: OpenCodeModeDeps = defaultDeps,
): Promise<ModeLaunchResult> {
  const commandContext = resolveCommandContext(launchContext);

  if (!deps.isInteractiveTerminal()) {
    return runSmokeCheck(handle, commandContext);
  }

  await ensurePersistentServerReady(handle, commandContext);
  await cleanupDetachedAttachClients(handle, commandContext);

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
        command: OPEN_CODE_ATTACH_COMMAND,
      }),
    );
  } finally {
    logger.verbose("Cleaning up interactive SSH session.");
    await deps.cleanupSession(handle, session);
  }

  return {
    mode: "ssh-opencode",
    command: "opencode",
    details: {
      session: "interactive",
      status: "completed",
    },
    message: `OpenCode interactive session ended for sandbox ${handle.sandboxId}`,
  };
}

async function ensurePersistentServerReady(
  handle: SandboxHandle,
  commandContext: { cwd?: string; envs: Record<string, string> },
): Promise<void> {
  logger.verbose("Ensuring OpenCode server is running for SSH attach mode.");
  await handle.run(OPEN_CODE_SERVER_BOOT_COMMAND, {
    ...(commandContext.cwd ? { cwd: commandContext.cwd } : {}),
    ...(Object.keys(commandContext.envs).length > 0 ? { envs: commandContext.envs } : {}),
    timeoutMs: SERVER_START_TIMEOUT_MS,
  });
  await handle.run(OPEN_CODE_SERVER_READINESS_COMMAND, {
    ...(commandContext.cwd ? { cwd: commandContext.cwd } : {}),
    ...(Object.keys(commandContext.envs).length > 0 ? { envs: commandContext.envs } : {}),
    timeoutMs: SERVER_READY_TIMEOUT_MS,
  });
}

async function cleanupDetachedAttachClients(
  handle: SandboxHandle,
  commandContext: { cwd?: string; envs: Record<string, string> },
): Promise<void> {
  logger.verbose("Cleaning up detached OpenCode attach clients.");
  await handle.run(OPEN_CODE_ATTACH_ORPHAN_CLEANUP_COMMAND, {
    ...(commandContext.cwd ? { cwd: commandContext.cwd } : {}),
    ...(Object.keys(commandContext.envs).length > 0 ? { envs: commandContext.envs } : {}),
    timeoutMs: ORPHAN_ATTACH_CLEANUP_TIMEOUT_MS,
  });
}

async function runSmokeCheck(
  handle: SandboxHandle,
  commandContext: { cwd?: string; envs: Record<string, string> },
): Promise<ModeLaunchResult> {
  const result = await handle.run(OPEN_CODE_SMOKE_COMMAND, {
    ...(commandContext.cwd ? { cwd: commandContext.cwd } : {}),
    ...(Object.keys(commandContext.envs).length > 0 ? { envs: commandContext.envs } : {}),
    timeoutMs: COMMAND_TIMEOUT_MS,
  });

  const output = firstNonEmptyLine(result.stdout, result.stderr);

  return {
    mode: "ssh-opencode",
    command: OPEN_CODE_SMOKE_COMMAND,
    details: {
      smoke: "opencode-cli",
      status: "ready",
      output,
    },
    message: `OpenCode CLI smoke passed in sandbox ${handle.sandboxId}: ${output}. Run from an interactive terminal for full OpenCode session attach.`,
  };
}

function resolveCommandContext(launchContext: LaunchContextOptions): { cwd?: string; envs: Record<string, string> } {
  return {
    cwd: normalizeOptionalValue(launchContext.workingDirectory),
    envs: launchContext.startupEnv ?? {},
  };
}

function normalizeOptionalValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function firstNonEmptyLine(stdout: string, stderr: string): string {
  const preferred = stdout.trim() || stderr.trim();
  if (preferred === "") {
    return "no output";
  }

  const [firstLine] = preferred.split("\n");
  return firstLine.trim();
}
