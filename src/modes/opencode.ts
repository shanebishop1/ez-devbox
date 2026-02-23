import type { SandboxHandle } from "../e2b/lifecycle.js";
import type { ModeLaunchResult } from "./index.js";
import {
  type SshModeDeps,
  cleanupSshBridgeSession,
  prepareSshBridgeSession,
  runInteractiveSshSession
} from "./ssh-bridge.js";

const OPEN_CODE_SMOKE_COMMAND = "opencode --version";
const OPEN_CODE_INTERACTIVE_COMMAND = "bash -lc 'opencode'";
const COMMAND_TIMEOUT_MS = 15_000;

type OpenCodeModeDeps = SshModeDeps;

const defaultDeps: OpenCodeModeDeps = {
  isInteractiveTerminal: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
  prepareSession: prepareSshBridgeSession,
  runInteractiveSession: runInteractiveSshSession,
  cleanupSession: cleanupSshBridgeSession
};

export async function startOpenCodeMode(handle: SandboxHandle, deps: OpenCodeModeDeps = defaultDeps): Promise<ModeLaunchResult> {
  if (!deps.isInteractiveTerminal()) {
    return runSmokeCheck(handle);
  }

  const session = await deps.prepareSession(handle);

  try {
    await deps.runInteractiveSession(session, OPEN_CODE_INTERACTIVE_COMMAND);
  } finally {
    await deps.cleanupSession(handle, session);
  }

  return {
    mode: "ssh-opencode",
    command: "opencode",
    details: {
      session: "interactive",
      status: "completed"
    },
    message: `OpenCode interactive session ended for sandbox ${handle.sandboxId}`
  };
}

async function runSmokeCheck(handle: SandboxHandle): Promise<ModeLaunchResult> {
  const result = await handle.run(OPEN_CODE_SMOKE_COMMAND, {
    timeoutMs: COMMAND_TIMEOUT_MS
  });

  const output = firstNonEmptyLine(result.stdout, result.stderr);

  return {
    mode: "ssh-opencode",
    command: OPEN_CODE_SMOKE_COMMAND,
    details: {
      smoke: "opencode-cli",
      status: "ready",
      output
    },
    message: `OpenCode CLI smoke passed in sandbox ${handle.sandboxId}: ${output}. Run from an interactive terminal for full OpenCode session attach.`
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
