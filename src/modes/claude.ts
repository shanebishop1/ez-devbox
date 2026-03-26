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

const CLAUDE_SMOKE_COMMAND = "claude --version";
const CLAUDE_ATTACH_TMUX_COMMAND = buildPersistentTmuxCommand({
  socketName: "ez-devbox-claude",
  sessionName: "ez-devbox-claude",
  command: "claude",
});
const CLAUDE_AVAILABILITY_CHECK_COMMAND =
  "bash -lc 'if command -v claude >/dev/null 2>&1; then printf PRESENT; else printf MISSING; fi'";
const CLAUDE_INSTALL_COMMAND_PRIMARY = "bash -lc 'curl -fsSL https://claude.ai/install.sh | bash'";
const CLAUDE_INSTALL_COMMAND_FALLBACK = "npm i -g @anthropic-ai/claude-code";
const COMMAND_TIMEOUT_MS = 15_000;
const INSTALL_TIMEOUT_MS = 120_000;

type ClaudeModeDeps = SshModeDeps;

const defaultDeps: ClaudeModeDeps = {
  isInteractiveTerminal: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
  prepareSession: prepareSshBridgeSession,
  runInteractiveSession: runInteractiveSshSession,
  cleanupSession: cleanupSshBridgeSession,
};

export async function startClaudeMode(
  handle: SandboxHandle,
  launchContext: LaunchContextOptions = {},
  deps: ClaudeModeDeps = defaultDeps,
): Promise<ModeLaunchResult> {
  const commandContext = resolveCommandContext(launchContext);
  await ensureClaudeCliAvailable(handle, commandContext);

  if (!deps.isInteractiveTerminal()) {
    return runSmokeCheck(handle, commandContext);
  }

  logger.verbose("Preparing secure SSH bridge (first run may install packages).");
  const session = await deps.prepareSession(handle);

  try {
    const envScriptPath = await stageInteractiveStartupEnv(handle, session, commandContext.envs);
    logger.verbose(
      "Claude SSH mode uses a persistent tmux session; use Ctrl+b d to detach while it continues running in the sandbox.",
    );
    logger.verbose("Opening interactive SSH session.");
    launchContext.onBeforeInteractiveSession?.();
    await deps.runInteractiveSession(
      session,
      buildInteractiveRemoteCommand({
        cwd: commandContext.cwd,
        envScriptPath,
        command: CLAUDE_ATTACH_TMUX_COMMAND,
      }),
    );
  } finally {
    logger.verbose("Cleaning up interactive SSH session.");
    await deps.cleanupSession(handle, session);
  }

  return {
    mode: "ssh-claude",
    command: "claude",
    details: {
      session: "interactive",
      status: "completed",
    },
    message: `Claude interactive session ended for sandbox ${handle.sandboxId}`,
  };
}

async function ensureClaudeCliAvailable(
  handle: SandboxHandle,
  commandContext: { cwd?: string; envs: Record<string, string> },
): Promise<void> {
  logger.verbose("Checking Claude CLI availability in sandbox.");
  const checkResult = await handle.run(CLAUDE_AVAILABILITY_CHECK_COMMAND, {
    ...(commandContext.cwd ? { cwd: commandContext.cwd } : {}),
    ...(Object.keys(commandContext.envs).length > 0 ? { envs: commandContext.envs } : {}),
    timeoutMs: COMMAND_TIMEOUT_MS,
  });

  if (checkResult.stdout.trim() === "PRESENT") {
    logger.verbose("Claude CLI is available in sandbox.");
    return;
  }

  logger.verbose("Claude CLI missing; installing via official install script.");
  const primaryInstallResult = await handle.run(CLAUDE_INSTALL_COMMAND_PRIMARY, {
    ...(commandContext.cwd ? { cwd: commandContext.cwd } : {}),
    ...(Object.keys(commandContext.envs).length > 0 ? { envs: commandContext.envs } : {}),
    timeoutMs: INSTALL_TIMEOUT_MS,
  });

  if (primaryInstallResult.exitCode !== 0) {
    logger.verbose("Primary Claude install failed; retrying with npm fallback package.");
    const fallbackInstallResult = await handle.run(CLAUDE_INSTALL_COMMAND_FALLBACK, {
      ...(commandContext.cwd ? { cwd: commandContext.cwd } : {}),
      ...(Object.keys(commandContext.envs).length > 0 ? { envs: commandContext.envs } : {}),
      timeoutMs: INSTALL_TIMEOUT_MS,
    });

    if (fallbackInstallResult.exitCode !== 0) {
      throw new Error(
        "Claude CLI is not available in the sandbox and automatic install failed. Install with 'curl -fsSL https://claude.ai/install.sh | bash' (or fallback 'npm i -g @anthropic-ai/claude-code') and retry.",
      );
    }
  }

  logger.verbose("Claude CLI install completed; verifying availability.");
  const verifyResult = await handle.run(CLAUDE_AVAILABILITY_CHECK_COMMAND, {
    ...(commandContext.cwd ? { cwd: commandContext.cwd } : {}),
    ...(Object.keys(commandContext.envs).length > 0 ? { envs: commandContext.envs } : {}),
    timeoutMs: COMMAND_TIMEOUT_MS,
  });

  if (verifyResult.stdout.trim() !== "PRESENT") {
    throw new Error(
      "Claude CLI install completed but claude is still unavailable in the sandbox. Install it manually and retry.",
    );
  }

  logger.verbose("Claude CLI is available in sandbox.");
}

async function runSmokeCheck(
  handle: SandboxHandle,
  commandContext: { cwd?: string; envs: Record<string, string> },
): Promise<ModeLaunchResult> {
  const result = await handle.run(CLAUDE_SMOKE_COMMAND, {
    ...(commandContext.cwd ? { cwd: commandContext.cwd } : {}),
    ...(Object.keys(commandContext.envs).length > 0 ? { envs: commandContext.envs } : {}),
    timeoutMs: COMMAND_TIMEOUT_MS,
  });

  const output = firstNonEmptyLine(result.stdout, result.stderr);

  return {
    mode: "ssh-claude",
    command: CLAUDE_SMOKE_COMMAND,
    details: {
      smoke: "claude-cli",
      status: "ready",
      output,
    },
    message: `Claude CLI smoke passed in sandbox ${handle.sandboxId}: ${output}`,
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
