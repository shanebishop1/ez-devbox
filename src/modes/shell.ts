import type { SandboxHandle } from "../e2b/lifecycle.js";
import type { LaunchContextOptions, ModeLaunchResult } from "./index.js";
import type { SshModeDeps } from "./ssh-bridge.js";
import { startTerminalAgent } from "./terminal-agent.js";

const SHELL_TMUX_NAME = "ez-devbox-shell";

type ShellModeDeps = SshModeDeps;

export async function startShellMode(
  handle: SandboxHandle,
  launchContext: LaunchContextOptions = {},
  deps?: ShellModeDeps,
): Promise<ModeLaunchResult> {
  return startTerminalAgent({
    handle,
    launchContext,
    ...(deps ? { deps } : {}),
    mode: "ssh-shell",
    executable: "bash -i",
    socketName: SHELL_TMUX_NAME,
    sessionName: SHELL_TMUX_NAME,
  });
}
