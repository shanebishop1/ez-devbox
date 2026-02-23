import type { SandboxHandle } from "../e2b/lifecycle.js";
import type { ModeLaunchResult } from "./index.js";

const CODEX_SMOKE_COMMAND = "codex --version";
const COMMAND_TIMEOUT_MS = 15_000;

export async function startCodexMode(handle: SandboxHandle): Promise<ModeLaunchResult> {
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
