import type { SandboxHandle } from "../e2b/lifecycle.js";
import type { ModeLaunchResult } from "./index.js";
import {
  type SshModeDeps,
  cleanupSshBridgeSession,
  prepareSshBridgeSession,
  runInteractiveSshSession
} from "./ssh-bridge.js";

const SHELL_SMOKE_COMMAND = "bash -lc 'echo shell-ready'";
const SHELL_INTERACTIVE_COMMAND = "bash";
const COMMAND_TIMEOUT_MS = 15_000;

type ShellModeDeps = SshModeDeps;

const defaultDeps: ShellModeDeps = {
  isInteractiveTerminal: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
  prepareSession: prepareSshBridgeSession,
  runInteractiveSession: runInteractiveSshSession,
  cleanupSession: cleanupSshBridgeSession
};

export async function startShellMode(handle: SandboxHandle, deps: ShellModeDeps = defaultDeps): Promise<ModeLaunchResult> {
  if (!deps.isInteractiveTerminal()) {
    return runSmokeCheck(handle);
  }

  const session = await deps.prepareSession(handle);

  try {
    await deps.runInteractiveSession(session, SHELL_INTERACTIVE_COMMAND);
  } finally {
    await deps.cleanupSession(handle, session);
  }

  return {
    mode: "ssh-shell",
    command: "bash",
    details: {
      session: "interactive",
      status: "completed"
    },
    message: `Shell interactive session ended for sandbox ${handle.sandboxId}`
  };
}

async function runSmokeCheck(handle: SandboxHandle): Promise<ModeLaunchResult> {
  const result = await handle.run(SHELL_SMOKE_COMMAND, {
    timeoutMs: COMMAND_TIMEOUT_MS
  });

  const output = result.stdout.trim() || "no output";

  return {
    mode: "ssh-shell",
    command: SHELL_SMOKE_COMMAND,
    details: {
      smoke: "shell",
      status: output === "shell-ready" ? "ready" : "unexpected-output",
      output
    },
    message: `Shell smoke check in sandbox ${handle.sandboxId}: ${output}`
  };
}
