import type { SandboxHandle } from "../e2b/lifecycle.js";
import { logger } from "../logging/logger.js";
import type { LaunchContextOptions, ModeLaunchResult } from "./index.js";
import { assertRemoteCommandSucceeded } from "./remote-command.js";
import type { SshModeDeps } from "./ssh-bridge.js";
import { startTerminalAgent } from "./terminal-agent.js";

const CLAUDE_TMUX_NAME = "ez-devbox-claude";
const CLAUDE_AVAILABILITY_CHECK_COMMAND =
  "bash -lc 'if command -v claude >/dev/null 2>&1; then printf PRESENT; else printf MISSING; fi'";
const CLAUDE_INSTALL_COMMAND_PRIMARY = "bash -lc 'curl -fsSL https://claude.ai/install.sh | bash'";
const CLAUDE_INSTALL_COMMAND_FALLBACK = "npm i -g @anthropic-ai/claude-code";
const COMMAND_TIMEOUT_MS = 15_000;
const INSTALL_TIMEOUT_MS = 120_000;

type ClaudeModeDeps = SshModeDeps;

export async function startClaudeMode(
  handle: SandboxHandle,
  launchContext: LaunchContextOptions = {},
  deps?: ClaudeModeDeps,
): Promise<ModeLaunchResult> {
  const commandContext = resolveCommandContext(launchContext);
  await ensureClaudeCliAvailable(handle, commandContext);

  return startTerminalAgent({
    handle,
    launchContext,
    ...(deps ? { deps } : {}),
    mode: "ssh-claude",
    executable: "claude",
    socketName: CLAUDE_TMUX_NAME,
    sessionName: CLAUDE_TMUX_NAME,
  });
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
  assertRemoteCommandSucceeded(checkResult, "Claude CLI availability check");

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
  assertRemoteCommandSucceeded(verifyResult, "Claude CLI post-install availability check");

  if (verifyResult.stdout.trim() !== "PRESENT") {
    throw new Error(
      "Claude CLI install completed but claude is still unavailable in the sandbox. Install it manually and retry.",
    );
  }

  logger.verbose("Claude CLI is available in sandbox.");
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
