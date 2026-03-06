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
import { buildPersistentTmuxCommand } from "./tmux.js";

const OPEN_CODE_SMOKE_COMMAND = "opencode --version";
const OPEN_CODE_ATTACH_COMMAND = "opencode attach http://127.0.0.1:4096";
const OPEN_CODE_ATTACH_TMUX_SOCKET = "ez-devbox-opencode";
const OPEN_CODE_ATTACH_TMUX_SESSION = "ez-devbox-opencode";
const OPEN_CODE_ATTACH_TMUX_COMMAND = buildPersistentTmuxCommand({
  socketName: OPEN_CODE_ATTACH_TMUX_SOCKET,
  sessionName: OPEN_CODE_ATTACH_TMUX_SESSION,
  command: OPEN_CODE_ATTACH_COMMAND,
  detachBehavior: "ctrl-c",
});
const OPEN_CODE_SERVER_BOOT_COMMAND =
  "nohup opencode serve --hostname 127.0.0.1 --port 4096 >/tmp/opencode-serve-ssh.log 2>&1 &";
const OPEN_CODE_SERVER_READINESS_COMMAND =
  'bash -lc \'for attempt in $(seq 1 30); do status=$(curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4096/global/health || true); if [ "$status" = "200" ] || [ "$status" = "401" ]; then exit 0; fi; sleep 1; done; exit 1\'';
const COMMAND_TIMEOUT_MS = 15_000;
const COMMAND_RETRY_TIMEOUT_MS = 60_000;
const COMMAND_MAX_ATTEMPTS = 2;
const SERVER_START_TIMEOUT_MS = 10_000;
const SERVER_READY_TIMEOUT_MS = 35_000;

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

  logger.verbose("Preparing secure SSH bridge (first run may install packages).");
  const session = await deps.prepareSession(handle);

  try {
    const envScriptPath = await stageInteractiveStartupEnv(handle, session, commandContext.envs);
    logger.verbose(
      "OpenCode SSH mode uses a persistent tmux session; Ctrl+C detaches your terminal while tasks continue.",
    );
    logger.verbose("Opening interactive SSH session.");
    await deps.runInteractiveSession(
      session,
      buildInteractiveRemoteCommand({
        cwd: commandContext.cwd,
        envScriptPath,
        command: OPEN_CODE_ATTACH_TMUX_COMMAND,
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

async function runSmokeCheck(
  handle: SandboxHandle,
  commandContext: { cwd?: string; envs: Record<string, string> },
): Promise<ModeLaunchResult> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= COMMAND_MAX_ATTEMPTS; attempt += 1) {
    const timeoutMs = attempt === 1 ? COMMAND_TIMEOUT_MS : COMMAND_RETRY_TIMEOUT_MS;

    try {
      const result = await handle.run(OPEN_CODE_SMOKE_COMMAND, {
        ...(commandContext.cwd ? { cwd: commandContext.cwd } : {}),
        ...(Object.keys(commandContext.envs).length > 0 ? { envs: commandContext.envs } : {}),
        timeoutMs,
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
    } catch (error) {
      lastError = error;
      if (!isCommandTimeoutError(error) || attempt >= COMMAND_MAX_ATTEMPTS) {
        throw error;
      }

      logger.verbose(
        `OpenCode smoke command timed out after ${timeoutMs}ms; retrying once with ${COMMAND_RETRY_TIMEOUT_MS}ms timeout.`,
      );
    }
  }

  throw lastError instanceof Error ? lastError : new Error("OpenCode smoke check failed unexpectedly.");
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

function isCommandTimeoutError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const normalizedMessage = error.message.toLowerCase();
  return normalizedMessage.includes("deadline_exceeded") || normalizedMessage.includes("timed out");
}
