import type { SandboxHandle } from "../e2b/lifecycle.js";
import { logger } from "../logging/logger.js";
import type { ModeLaunchResult } from "./index.js";
import {
  type SshModeDeps,
  cleanupSshBridgeSession,
  prepareSshBridgeSession,
  runInteractiveSshSession
} from "./ssh-bridge.js";

const CODEX_SMOKE_COMMAND = "codex --version";
const CODEX_INTERACTIVE_COMMAND = "bash -lc 'codex'";
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

export async function startCodexMode(handle: SandboxHandle, deps: CodexModeDeps = defaultDeps): Promise<ModeLaunchResult> {
  await ensureCodexCliAvailable(handle);

  if (!deps.isInteractiveTerminal()) {
    return runSmokeCheck(handle);
  }

  logger.info("Preparing secure SSH bridge (first run may install packages).");
  const session = await deps.prepareSession(handle);

  try {
    logger.info("Opening interactive SSH session.");
    await deps.runInteractiveSession(session, CODEX_INTERACTIVE_COMMAND);
  } finally {
    logger.info("Cleaning up interactive SSH session.");
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

async function ensureCodexCliAvailable(handle: SandboxHandle): Promise<void> {
  logger.info("Checking Codex CLI availability in sandbox.");
  const checkResult = await handle.run(CODEX_AVAILABILITY_CHECK_COMMAND, {
    timeoutMs: COMMAND_TIMEOUT_MS
  });

  if (checkResult.stdout.trim() === "PRESENT") {
    logger.info("Codex CLI is available in sandbox.");
    return;
  }

  logger.info("Codex CLI missing; installing @openai/codex globally.");
  const installResult = await handle.run(CODEX_INSTALL_COMMAND, {
    timeoutMs: INSTALL_TIMEOUT_MS
  });

  if (installResult.exitCode !== 0) {
    throw new Error(
      "Codex CLI is not available in the sandbox and automatic install failed. Install it in the sandbox with 'npm i -g @openai/codex' and retry."
    );
  }

  logger.info("Codex CLI install completed; verifying availability.");
  const verifyResult = await handle.run(CODEX_AVAILABILITY_CHECK_COMMAND, {
    timeoutMs: COMMAND_TIMEOUT_MS
  });

  if (verifyResult.stdout.trim() !== "PRESENT") {
    throw new Error(
      "Codex CLI install completed but codex is still unavailable in the sandbox. Install it manually with 'npm i -g @openai/codex' and retry."
    );
  }

  logger.info("Codex CLI is available in sandbox.");
}

async function runSmokeCheck(handle: SandboxHandle): Promise<ModeLaunchResult> {
  const result = await handle.run(CODEX_SMOKE_COMMAND, {
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

function firstNonEmptyLine(stdout: string, stderr: string): string {
  const preferred = stdout.trim() || stderr.trim();
  if (preferred === "") {
    return "no output";
  }

  const [firstLine] = preferred.split("\n");
  return firstLine.trim();
}
