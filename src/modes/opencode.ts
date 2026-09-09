import { spawnSync } from "node:child_process";
import type { SandboxHandle } from "../e2b/lifecycle.js";
import { logger } from "../logging/logger.js";
import { redactSensitiveText } from "../security/redaction.js";
import type { LaunchContextOptions, ModeLaunchResult } from "./index.js";
import { assertRemoteCommandSucceeded } from "./remote-command.js";
import {
  cleanupSshBridgeSession,
  prepareSshBridgeSession,
  runInteractiveSshSession,
  type SshModeDeps,
} from "./ssh-bridge.js";
import { startTerminalAgent } from "./terminal-agent.js";

const OPEN_CODE_SMOKE_COMMAND = "opencode --version";
const OPEN_CODE_ATTACH_COMMAND = "opencode attach http://127.0.0.1:4096";
const OPEN_CODE_ATTACH_TMUX_SOCKET = "ez-devbox-opencode";
const OPEN_CODE_ATTACH_TMUX_SESSION = "ez-devbox-opencode";
const OPEN_CODE_SERVER_BOOT_COMMAND =
  'bash -lc \'status=$(curl --connect-timeout 2 --max-time 3 -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4096/global/health || true); if [ "$status" = 200 ] || [ "$status" = 401 ]; then exit 0; fi; nohup opencode serve --hostname 127.0.0.1 --port 4096 >/tmp/opencode-serve-ssh.log 2>&1 &\'';
const OPEN_CODE_SERVER_READINESS_COMMAND =
  'bash -lc \'for attempt in $(seq 1 30); do for path in global/health api/health; do status=$(curl --connect-timeout 1 --max-time 1 -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:4096/$path" || true); if [ "$status" = "200" ] || [ "$status" = "401" ]; then exit 0; fi; done; sleep 1; done; printf "%s\\n" "OpenCode did not become ready; see /tmp/opencode-serve-ssh.log" >&2; exit 1\'';
const SERVER_START_TIMEOUT_MS = 10_000;
// The shell probe has a 55-second limit; disable E2B's shorter request deadline.
const SERVER_READY_TIMEOUT_MS = 0;
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

  launchContext.onLaunchStageUpdate?.("Launching ssh-opencode: starting OpenCode server...", "OpenCode server ready");
  await ensurePersistentServerReady(handle, commandContext);

  const shouldDetach = launchContext.detach || launchContext.nonInteractive || !deps.isInteractiveTerminal();
  if (!shouldDetach) {
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
  }

  return startTerminalAgent({
    handle,
    launchContext: { ...launchContext, detach: shouldDetach },
    deps,
    mode: "ssh-opencode",
    executable: OPEN_CODE_ATTACH_COMMAND,
    socketName: OPEN_CODE_ATTACH_TMUX_SOCKET,
    sessionName: OPEN_CODE_ATTACH_TMUX_SESSION,
    detachBehavior: "ctrl-c",
    initialPromptStrategy: "tmux",
  });
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
    const upgradeResult = await handle.run(`${OPEN_CODE_UPGRADE_COMMAND_PREFIX} ${localVersion} -m npm`, {
      ...commandOptions,
      timeoutMs: VERSION_UPGRADE_TIMEOUT_MS,
    });
    assertRemoteCommandSucceeded(upgradeResult, "OpenCode version match");
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
    assertRemoteCommandSucceeded(currentResult, "OpenCode version check");
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
  const startResult = await handle.run(OPEN_CODE_SERVER_BOOT_COMMAND, {
    ...(commandContext.cwd ? { cwd: commandContext.cwd } : {}),
    ...(Object.keys(commandContext.envs).length > 0 ? { envs: commandContext.envs } : {}),
    timeoutMs: SERVER_START_TIMEOUT_MS,
  });
  assertRemoteCommandSucceeded(startResult, "OpenCode server start");
  try {
    const readinessResult = await handle.run(OPEN_CODE_SERVER_READINESS_COMMAND, {
      ...(commandContext.cwd ? { cwd: commandContext.cwd } : {}),
      ...(Object.keys(commandContext.envs).length > 0 ? { envs: commandContext.envs } : {}),
      timeoutMs: SERVER_READY_TIMEOUT_MS,
    });
    assertRemoteCommandSucceeded(readinessResult, "OpenCode server readiness check");
  } catch (error) {
    throw await createServerReadinessError(handle, error);
  }
}

async function createServerReadinessError(handle: SandboxHandle, error: unknown): Promise<Error> {
  const logResult = await handle
    .run("bash -lc 'tail -n 30 /tmp/opencode-serve-ssh.log 2>/dev/null || true'", { timeoutMs: 10_000 })
    .catch(() => undefined);
  const log = logResult ? logResult.stdout.trim() || logResult.stderr.trim() : "";
  const detail = log ? `${toErrorMessage(error)}: ${redactSensitiveText(log)}` : toErrorMessage(error);
  return new Error(`OpenCode server readiness check failed: ${detail}`);
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
