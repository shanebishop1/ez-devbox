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

const CODEX_SMOKE_COMMAND = "codex --version";
const CODEX_AVAILABILITY_CHECK_COMMAND = "bash -lc 'if command -v codex >/dev/null 2>&1; then printf PRESENT; else printf MISSING; fi'";
const CODEX_INSTALL_COMMAND = "npm i -g @openai/codex";
const COMMAND_TIMEOUT_MS = 15_000;
const INSTALL_TIMEOUT_MS = 120_000;

type CodexModeDeps = SshModeDeps;

const defaultDeps: CodexModeDeps = {
  isInteractiveTerminal: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
  prepareSession: prepareSshBridgeSession,
  runInteractiveSession: runInteractiveSshSession,
  cleanupSession: cleanupSshBridgeSession
};

export async function startCodexMode(
  handle: SandboxHandle,
  launchContext: LaunchContextOptions = {},
  deps: CodexModeDeps = defaultDeps
): Promise<ModeLaunchResult> {
  const commandContext = resolveCommandContext(launchContext);
  await ensureCodexCliAvailable(handle, commandContext);

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
        command: "codex"
      })
    );
  } finally {
    logger.verbose("Cleaning up interactive SSH session.");
    await deps.cleanupSession(handle, session);
  }

  return {
    mode: "ssh-codex",
    command: "codex",
    details: {
      session: "interactive",
      status: "completed"
    },
    message: `Codex interactive session ended for sandbox ${handle.sandboxId}`
  };
}

async function ensureCodexCliAvailable(
  handle: SandboxHandle,
  commandContext: { cwd?: string; envs: Record<string, string> }
): Promise<void> {
  logger.verbose("Checking Codex CLI availability in sandbox.");
  const checkResult = await handle.run(CODEX_AVAILABILITY_CHECK_COMMAND, {
    ...(commandContext.cwd ? { cwd: commandContext.cwd } : {}),
    ...(Object.keys(commandContext.envs).length > 0 ? { envs: commandContext.envs } : {}),
    timeoutMs: COMMAND_TIMEOUT_MS
  });

  if (checkResult.stdout.trim() === "PRESENT") {
    logger.verbose("Codex CLI is available in sandbox.");
    return;
  }

  logger.verbose("Codex CLI missing; installing @openai/codex globally.");
  const installResult = await handle.run(CODEX_INSTALL_COMMAND, {
    ...(commandContext.cwd ? { cwd: commandContext.cwd } : {}),
    ...(Object.keys(commandContext.envs).length > 0 ? { envs: commandContext.envs } : {}),
    timeoutMs: INSTALL_TIMEOUT_MS
  });

  if (installResult.exitCode !== 0) {
    throw new Error(
      "Codex CLI is not available in the sandbox and automatic install failed. Install it in the sandbox with 'npm i -g @openai/codex' and retry."
    );
  }

  logger.verbose("Codex CLI install completed; verifying availability.");
  const verifyResult = await handle.run(CODEX_AVAILABILITY_CHECK_COMMAND, {
    ...(commandContext.cwd ? { cwd: commandContext.cwd } : {}),
    ...(Object.keys(commandContext.envs).length > 0 ? { envs: commandContext.envs } : {}),
    timeoutMs: COMMAND_TIMEOUT_MS
  });

  if (verifyResult.stdout.trim() !== "PRESENT") {
    throw new Error(
      "Codex CLI install completed but codex is still unavailable in the sandbox. Install it manually with 'npm i -g @openai/codex' and retry."
    );
  }

  logger.verbose("Codex CLI is available in sandbox.");
}

async function runSmokeCheck(
  handle: SandboxHandle,
  commandContext: { cwd?: string; envs: Record<string, string> }
): Promise<ModeLaunchResult> {
  const result = await handle.run(CODEX_SMOKE_COMMAND, {
    ...(commandContext.cwd ? { cwd: commandContext.cwd } : {}),
    ...(Object.keys(commandContext.envs).length > 0 ? { envs: commandContext.envs } : {}),
    timeoutMs: COMMAND_TIMEOUT_MS
  });

  const output = firstNonEmptyLine(result.stdout, result.stderr);

  return {
    mode: "ssh-codex",
    command: CODEX_SMOKE_COMMAND,
    details: {
      smoke: "codex-cli",
      status: "ready",
      output
    },
    message: `Codex CLI smoke passed in sandbox ${handle.sandboxId}: ${output}`
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

function firstNonEmptyLine(stdout: string, stderr: string): string {
  const preferred = stdout.trim() || stderr.trim();
  if (preferred === "") {
    return "no output";
  }

  const [firstLine] = preferred.split("\n");
  return firstLine.trim();
}
