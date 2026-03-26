import { spawnSync } from "node:child_process";
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
const VERSION_CHECK_TIMEOUT_MS = 20_000;
const VERSION_UPGRADE_TIMEOUT_MS = 90_000;
const LOCAL_VERSION_TIMEOUT_MS = 8_000;
const OPEN_CODE_UPGRADE_COMMAND_PREFIX = "opencode upgrade";

type OpenCodeModeDeps = SshModeDeps & {
  resolveLocalOpenCodeVersion?: () => string | undefined;
};

const defaultDeps: OpenCodeModeDeps = {
  isInteractiveTerminal: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
  prepareSession: prepareSshBridgeSession,
  runInteractiveSession: runInteractiveSshSession,
  cleanupSession: cleanupSshBridgeSession,
  resolveLocalOpenCodeVersion,
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

  launchContext.onLaunchStageUpdate?.(
    "Launching ssh-opencode: checking OpenCode version...",
    "Checked OpenCode version",
  );
  await inspectAndMaybeMatchOpenCodeVersion(
    handle,
    commandContext,
    launchContext.matchLocalOpenCodeVersion ?? true,
    deps.resolveLocalOpenCodeVersion ?? resolveLocalOpenCodeVersion,
    launchContext.onLaunchStageUpdate,
  );

  launchContext.onLaunchStageUpdate?.("Launching ssh-opencode: starting OpenCode server...", "OpenCode server ready");
  await ensurePersistentServerReady(handle, commandContext);

  launchContext.onLaunchStageUpdate?.("Launching ssh-opencode: preparing SSH bridge...", "SSH bridge ready");
  logger.verbose("Preparing secure SSH bridge (first run may install packages).");
  const session = await deps.prepareSession(handle);

  try {
    launchContext.onLaunchStageUpdate?.("Launching ssh-opencode: preparing SSH handoff...", "Prepared SSH handoff");
    const envScriptPath = await stageInteractiveStartupEnv(handle, session, commandContext.envs);
    logger.verbose(
      "OpenCode SSH mode uses a persistent tmux session; Ctrl+C detaches your terminal while tasks continue.",
    );
    logger.verbose("Opening interactive SSH session.");
    launchContext.onBeforeInteractiveSession?.();
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

async function inspectAndMaybeMatchOpenCodeVersion(
  handle: SandboxHandle,
  commandContext: { cwd?: string; envs: Record<string, string> },
  matchLocalVersion: boolean,
  localVersionResolver: () => string | undefined,
  onLaunchStageUpdate?: (loadingMessage: string, completionMessage: string) => void,
): Promise<void> {
  const localVersion = localVersionResolver();
  const sandboxVersion = await resolveSandboxOpenCodeVersion(handle, commandContext);

  if (localVersion && sandboxVersion) {
    logger.info(`OpenCode versions: local=${localVersion}, sandbox=${sandboxVersion}`);
  } else if (sandboxVersion) {
    logger.info(`OpenCode version in sandbox: ${sandboxVersion} (local version unavailable)`);
  } else if (localVersion) {
    logger.info(`OpenCode version on host: ${localVersion} (sandbox version unavailable)`);
  } else {
    logger.warn("OpenCode version check unavailable on both host and sandbox.");
    return;
  }

  if (!matchLocalVersion) {
    logger.verbose("OpenCode local/sandbox version matching disabled by config (opencode.match_local_version=false).");
    return;
  }

  if (!localVersion || !sandboxVersion || localVersion === sandboxVersion) {
    return;
  }

  onLaunchStageUpdate?.(
    `Launching ssh-opencode: matching OpenCode version (${sandboxVersion} -> ${localVersion})...`,
    "Finished OpenCode version match attempt",
  );
  logger.info(`Attempting to match sandbox OpenCode version to local ${localVersion}.`);

  const commandOptions = {
    ...(commandContext.cwd ? { cwd: commandContext.cwd } : {}),
    ...(Object.keys(commandContext.envs).length > 0 ? { envs: commandContext.envs } : {}),
  };

  try {
    await handle.run(`${OPEN_CODE_UPGRADE_COMMAND_PREFIX} ${localVersion} -m npm`, {
      ...commandOptions,
      timeoutMs: VERSION_UPGRADE_TIMEOUT_MS,
    });
  } catch (error) {
    logger.warn(`OpenCode version match failed before launch: ${toErrorMessage(error)}`);
    return;
  }

  const afterMatchVersion = await resolveSandboxOpenCodeVersion(handle, commandContext);
  if (afterMatchVersion === localVersion) {
    logger.info(`Matched sandbox OpenCode version to local ${localVersion}.`);
    return;
  }

  if (afterMatchVersion) {
    logger.warn(
      `OpenCode version match incomplete: local=${localVersion}, sandbox=${afterMatchVersion}. Template-managed sandbox binary may not be replaceable in this environment.`,
    );
    return;
  }

  logger.warn(
    `OpenCode version match attempted but post-check version is unavailable (local=${localVersion}, sandbox(before)=${sandboxVersion}).`,
  );
}

async function resolveSandboxOpenCodeVersion(
  handle: SandboxHandle,
  commandContext: { cwd?: string; envs: Record<string, string> },
): Promise<string | undefined> {
  const commandOptions = {
    ...(commandContext.cwd ? { cwd: commandContext.cwd } : {}),
    ...(Object.keys(commandContext.envs).length > 0 ? { envs: commandContext.envs } : {}),
  };

  try {
    const currentResult = await handle.run(OPEN_CODE_SMOKE_COMMAND, {
      ...commandOptions,
      timeoutMs: VERSION_CHECK_TIMEOUT_MS,
    });
    return parseSemver(currentResult.stdout);
  } catch (error) {
    logger.verbose(`Unable to read current OpenCode version in sandbox: ${toErrorMessage(error)}.`);
    return undefined;
  }
}

function resolveLocalOpenCodeVersion(): string | undefined {
  const result = spawnSync("opencode", ["--version"], {
    encoding: "utf8",
    timeout: LOCAL_VERSION_TIMEOUT_MS,
  });

  if (result.error) {
    logger.verbose(`Unable to read local OpenCode version: ${result.error.message}`);
    return undefined;
  }

  if (result.status !== 0) {
    logger.verbose("Unable to read local OpenCode version: command returned non-zero status.");
    return undefined;
  }

  return parseSemver(result.stdout ?? "");
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

function parseSemver(value: string): string | undefined {
  const match = value.match(/\b\d+\.\d+\.\d+\b/);
  return match?.[0];
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }

  return "unknown error";
}
