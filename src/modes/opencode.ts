import type { SandboxHandle } from "../e2b/lifecycle.js";
import type { ModeLaunchResult } from "./index.js";

const OPEN_CODE_COMMAND = "opencode";

export async function startOpenCodeMode(handle: SandboxHandle): Promise<ModeLaunchResult> {
  await handle.run(OPEN_CODE_COMMAND);

  return {
    mode: "ssh-opencode",
    command: OPEN_CODE_COMMAND,
    message: `Started OpenCode in sandbox ${handle.sandboxId}`
  };
}
