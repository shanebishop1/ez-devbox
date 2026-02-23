import type { SandboxHandle } from "../e2b/lifecycle.js";
import type { ModeLaunchResult } from "./index.js";

const OPEN_CODE_SMOKE_COMMAND = "opencode --version";
const COMMAND_TIMEOUT_MS = 15_000;

export async function startOpenCodeMode(handle: SandboxHandle): Promise<ModeLaunchResult> {
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
    message: `OpenCode CLI smoke passed in sandbox ${handle.sandboxId}: ${output}`
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
