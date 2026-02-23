import type { SandboxHandle } from "../e2b/lifecycle.js";
import type { ModeLaunchResult } from "./index.js";

const SHELL_SMOKE_COMMAND = "bash -lc 'echo shell-ready'";
const COMMAND_TIMEOUT_MS = 15_000;

export async function startShellMode(handle: SandboxHandle): Promise<ModeLaunchResult> {
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
