import type { SandboxHandle } from "../e2b/lifecycle.js";
import { logger } from "../logging/logger.js";
import type { LaunchContextOptions, ModeLaunchResult } from "./index.js";
import { assertRemoteCommandSucceeded } from "./remote-command.js";
import type { SshModeDeps } from "./ssh-bridge.js";
import { startTerminalAgent } from "./terminal-agent.js";

const CODEX_TMUX_NAME = "ez-devbox-codex";
const CODEX_AVAILABILITY_CHECK_COMMAND =
  "bash -lc 'if command -v codex >/dev/null 2>&1; then printf PRESENT; else printf MISSING; fi'";
const CODEX_INSTALL_COMMAND = "npm i -g @openai/codex";
const COMMAND_TIMEOUT_MS = 15_000;
const INSTALL_TIMEOUT_MS = 120_000;

type CodexModeDeps = SshModeDeps;

export async function startCodexMode(
  handle: SandboxHandle,
  launchContext: LaunchContextOptions = {},
  deps?: CodexModeDeps,
): Promise<ModeLaunchResult> {
  const commandContext = resolveCommandContext(launchContext);
  await ensureCodexCliAvailable(handle, commandContext);

  return startTerminalAgent({
    handle,
    launchContext,
    ...(deps ? { deps } : {}),
    mode: "ssh-codex",
    executable: "codex",
    socketName: CODEX_TMUX_NAME,
    sessionName: CODEX_TMUX_NAME,
  });
}

async function ensureCodexCliAvailable(
  handle: SandboxHandle,
  commandContext: { cwd?: string; envs: Record<string, string> },
): Promise<void> {
  logger.verbose("Checking Codex CLI availability in sandbox.");
  const checkResult = await handle.run(CODEX_AVAILABILITY_CHECK_COMMAND, {
    ...(commandContext.cwd ? { cwd: commandContext.cwd } : {}),
    ...(Object.keys(commandContext.envs).length > 0 ? { envs: commandContext.envs } : {}),
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
  assertRemoteCommandSucceeded(checkResult, "Codex CLI availability check");

  if (checkResult.stdout.trim() === "PRESENT") {
    logger.verbose("Codex CLI is available in sandbox.");
    return;
  }

  logger.verbose("Codex CLI missing; installing @openai/codex globally.");
  const installResult = await handle.run(CODEX_INSTALL_COMMAND, {
    ...(commandContext.cwd ? { cwd: commandContext.cwd } : {}),
    ...(Object.keys(commandContext.envs).length > 0 ? { envs: commandContext.envs } : {}),
    timeoutMs: INSTALL_TIMEOUT_MS,
  });

  if (installResult.exitCode !== 0) {
    throw new Error(
      "Codex CLI is not available in the sandbox and automatic install failed. Install it in the sandbox with 'npm i -g @openai/codex' and retry.",
    );
  }

  logger.verbose("Codex CLI install completed; verifying availability.");
  const verifyResult = await handle.run(CODEX_AVAILABILITY_CHECK_COMMAND, {
    ...(commandContext.cwd ? { cwd: commandContext.cwd } : {}),
    ...(Object.keys(commandContext.envs).length > 0 ? { envs: commandContext.envs } : {}),
    timeoutMs: COMMAND_TIMEOUT_MS,
  });
  assertRemoteCommandSucceeded(verifyResult, "Codex CLI post-install availability check");

  if (verifyResult.stdout.trim() !== "PRESENT") {
    throw new Error(
      "Codex CLI install completed but codex is still unavailable in the sandbox. Install it manually with 'npm i -g @openai/codex' and retry.",
    );
  }

  logger.verbose("Codex CLI is available in sandbox.");
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
