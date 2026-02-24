import type { SandboxHandle } from "../e2b/lifecycle.js";
import { logger } from "../logging/logger.js";
import type { LaunchContextOptions, ModeLaunchResult } from "./index.js";
import {
  type SshModeDeps,
  cleanupSshBridgeSession,
  prepareSshBridgeSession,
  runInteractiveSshSession
} from "./ssh-bridge.js";

const OPEN_CODE_SMOKE_COMMAND = "opencode --version";
const COMMAND_TIMEOUT_MS = 15_000;

type OpenCodeModeDeps = SshModeDeps;

const defaultDeps: OpenCodeModeDeps = {
  isInteractiveTerminal: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
  prepareSession: prepareSshBridgeSession,
  runInteractiveSession: runInteractiveSshSession,
  cleanupSession: cleanupSshBridgeSession
};

export async function startOpenCodeMode(
  handle: SandboxHandle,
  launchContext: LaunchContextOptions = {},
  deps: OpenCodeModeDeps = defaultDeps
): Promise<ModeLaunchResult> {
  const commandContext = resolveCommandContext(launchContext);

  if (!deps.isInteractiveTerminal()) {
    return runSmokeCheck(handle, commandContext);
  }

  logger.info("Preparing secure SSH bridge (first run may install packages).");
  const session = await deps.prepareSession(handle);

  try {
    logger.info("Opening interactive SSH session.");
    await deps.runInteractiveSession(session, buildInteractiveCommand("opencode", commandContext.cwd, commandContext.envs));
  } finally {
    logger.info("Cleaning up interactive SSH session.");
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

async function runSmokeCheck(
  handle: SandboxHandle,
  commandContext: { cwd?: string; envs: Record<string, string> }
): Promise<ModeLaunchResult> {
  const result = await handle.run(OPEN_CODE_SMOKE_COMMAND, {
    ...(commandContext.cwd ? { cwd: commandContext.cwd } : {}),
    ...(Object.keys(commandContext.envs).length > 0 ? { envs: commandContext.envs } : {}),
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

function buildInteractiveCommand(command: string, cwd?: string, envs: Record<string, string> = {}): string {
  const steps: string[] = [];
  steps.push('export PATH="$HOME/.local/bin:$HOME/.local/share/mise/shims:$PATH"');
  if (cwd) {
    steps.push(`cd ${quoteShellArg(cwd)}`);
  }
  for (const [key, value] of Object.entries(envs)) {
    steps.push(`export ${key}=${quoteShellArg(value)}`);
  }
  steps.push(`exec ${command}`);
  return `bash -lc ${quoteShellArg(steps.join(" && "))}`;
}

function resolveCommandContext(launchContext: LaunchContextOptions): { cwd?: string; envs: Record<string, string> } {
  return {
    cwd: normalizeOptionalValue(launchContext.workingDirectory),
    envs: launchContext.startupEnv ?? {}
  };
}

function normalizeOptionalValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

function firstNonEmptyLine(stdout: string, stderr: string): string {
  const preferred = stdout.trim() || stderr.trim();
  if (preferred === "") {
    return "no output";
  }

  const [firstLine] = preferred.split("\n");
  return firstLine.trim();
}
