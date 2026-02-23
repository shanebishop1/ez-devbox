import type { SandboxHandle } from "../e2b/lifecycle.js";
import type { ModeLaunchResult } from "./index.js";
import {
  type SshModeDeps,
  cleanupSshBridgeSession,
  prepareSshBridgeSession,
  runInteractiveSshSession
} from "./ssh-bridge.js";

const CODEX_SMOKE_COMMAND = "codex --version";
const CODEX_INTERACTIVE_COMMAND = "bash -lc 'codex'";
const COMMAND_TIMEOUT_MS = 15_000;

type CodexModeDeps = SshModeDeps;

const defaultDeps: CodexModeDeps = {
  isInteractiveTerminal: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
  prepareSession: prepareSshBridgeSession,
  runInteractiveSession: runInteractiveSshSession,
  cleanupSession: cleanupSshBridgeSession
};

export async function startCodexMode(handle: SandboxHandle, deps: CodexModeDeps = defaultDeps): Promise<ModeLaunchResult> {
  if (!deps.isInteractiveTerminal()) {
    return runSmokeCheck(handle);
  }

  const session = await deps.prepareSession(handle);

  try {
    await deps.runInteractiveSession(session, CODEX_INTERACTIVE_COMMAND);
  } finally {
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
