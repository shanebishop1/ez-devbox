import type { SandboxHandle } from "../e2b/lifecycle.js";
import type { ModeLaunchResult } from "./index.js";

const SHELL_COMMAND = "bash -l";

export async function startShellMode(handle: SandboxHandle): Promise<ModeLaunchResult> {
  await handle.run(SHELL_COMMAND);

  return {
    mode: "ssh-shell",
    command: SHELL_COMMAND,
    message: `Started shell in sandbox ${handle.sandboxId}`
  };
}
