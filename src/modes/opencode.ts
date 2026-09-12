import type { SandboxHandle } from "../e2b/lifecycle.js";
import { logger } from "../logging/logger.js";
import { redactSensitiveText } from "../security/redaction.js";
import type { LaunchContextOptions, ModeLaunchResult } from "./index.js";
import {
  inspectAndMaybeMatchNewOpenCodeVersion,
  inspectOpenCodeBackend,
  reportExistingBackendVersion,
  resolveLocalOpenCodeVersion,
  resolveLocalVersion,
  resolveSandboxOpenCodeVersion,
} from "./opencode.version.js";
import { assertRemoteCommandSucceeded } from "./remote-command.js";
import {
  cleanupSshBridgeSession,
  prepareSshBridgeSession,
  runInteractiveSshSession,
  type SshModeDeps,
} from "./ssh-bridge.js";
import { startTerminalAgent } from "./terminal-agent.js";

const OPEN_CODE_ATTACH_COMMAND = "opencode attach http://127.0.0.1:4096";
const OPEN_CODE_ATTACH_TMUX_SOCKET = "ez-devbox-opencode";
const OPEN_CODE_ATTACH_TMUX_SESSION = "ez-devbox-opencode";
const OPEN_CODE_SERVER_BOOT_COMMAND =
  'bash -lc \'status=$(curl --connect-timeout 2 --max-time 3 -s -o /dev/null -w "%{http_code}" http://127.0.0.1:4096/global/health); curl_exit=$?; if [ "$curl_exit" -ne 7 ] || [ "$status" != 000 ]; then exit 0; fi; nohup opencode serve --hostname 127.0.0.1 --port 4096 >/tmp/opencode-serve-ssh.log 2>&1 &\'';
const OPEN_CODE_SERVER_READINESS_COMMAND =
  'bash -lc \'for attempt in $(seq 1 30); do status=$(curl --connect-timeout 1 --max-time 1 -s -o /dev/null -w "%{http_code}" "http://127.0.0.1:4096/global/health" || true); if [ "$status" = "200" ] || [ "$status" = "401" ]; then exit 0; fi; sleep 1; done; printf "%s\\n" "OpenCode did not become ready; see /tmp/opencode-serve-ssh.log" >&2; exit 1\'';
const SERVER_START_TIMEOUT_MS = 10_000;
// The readiness shell loop can run for about 60 seconds; disable E2B's shorter request deadline.
const SERVER_READY_TIMEOUT_MS = 0;

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
  deps: Partial<OpenCodeModeDeps> = {},
): Promise<ModeLaunchResult> {
  const commandContext = resolveCommandContext(launchContext);
  const matchLocalVersion = launchContext.matchLocalOpenCodeVersion ?? true;
  const resolvedDeps: OpenCodeModeDeps = { ...defaultDeps, ...deps };

  const shouldDetach = launchContext.detach || launchContext.nonInteractive || !resolvedDeps.isInteractiveTerminal();
  if (matchLocalVersion) {
    launchContext.onLaunchStageUpdate?.(
      "Launching ssh-opencode: checking OpenCode version...",
      "Checked OpenCode version",
    );
  }

  const backend = await inspectOpenCodeBackend(handle, commandContext);
  const localVersion = matchLocalVersion
    ? resolveLocalVersion(resolvedDeps.resolveLocalOpenCodeVersion ?? resolveLocalOpenCodeVersion)
    : undefined;

  if (!matchLocalVersion) {
    logger.verbose("OpenCode local/sandbox version matching disabled by config (opencode.match_local_version=false).");
  } else if (backend.state === "existing") {
    const clientVersion =
      backend.status === 200 && backend.version
        ? await resolveSandboxOpenCodeVersion(handle, commandContext)
        : undefined;
    reportExistingBackendVersion(backend, localVersion, clientVersion);
  } else if (backend.state === "absent") {
    await inspectAndMaybeMatchNewOpenCodeVersion(
      handle,
      commandContext,
      localVersion,
      launchContext.onLaunchStageUpdate,
    );
  } else {
    logger.warn(
      "Unable to determine whether an OpenCode backend is already running; skipping version upgrade to avoid changing an active session.",
    );
  }

  launchContext.onLaunchStageUpdate?.("Launching ssh-opencode: starting OpenCode server...", "OpenCode server ready");
  await ensurePersistentServerReady(handle, commandContext);

  return startTerminalAgent({
    handle,
    launchContext: { ...launchContext, detach: shouldDetach },
    deps: resolvedDeps,
    mode: "ssh-opencode",
    executable: OPEN_CODE_ATTACH_COMMAND,
    socketName: OPEN_CODE_ATTACH_TMUX_SOCKET,
    sessionName: OPEN_CODE_ATTACH_TMUX_SESSION,
    detachBehavior: "ctrl-c",
    initialPromptStrategy: "tmux",
  });
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

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }

  return "unknown error";
}
