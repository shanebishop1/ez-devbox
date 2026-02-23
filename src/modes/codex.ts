import type { SandboxHandle } from "../e2b/lifecycle.js";
import type { ModeLaunchResult } from "./index.js";

const CODEX_COMMAND = "codex";

export async function startCodexMode(handle: SandboxHandle): Promise<ModeLaunchResult> {
  await handle.run(CODEX_COMMAND);

  return {
    mode: "ssh-codex",
    command: CODEX_COMMAND,
    message: `Started Codex in sandbox ${handle.sandboxId}`
  };
}
