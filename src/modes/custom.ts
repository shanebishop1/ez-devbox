import { getCustomAgentFingerprint } from "../config/custom-agent.validation.js";
import type { ResolvedCustomAgentConfig } from "../config/schema.js";
import { LauncherE2BLifecycleError, type SandboxHandle } from "../e2b/lifecycle.js";
import { logger } from "../logging/logger.js";
import { buildArgvCommand } from "../utils/shell.js";
import type { LaunchContextOptions, ModeLaunchResult } from "./index.js";
import type { SshModeDeps } from "./ssh-bridge.js";
import { startTerminalAgent } from "./terminal-agent.js";
import { hasPersistentTmuxSession } from "./tmux.js";

const CUSTOM_TMUX_NAME = "ez-devbox-custom";
const COMMAND_TIMEOUT_MS = 15_000;
const INSTALL_TIMEOUT_MS = 120_000;

type CustomModeDeps = SshModeDeps;

export async function startCustomMode(
  handle: SandboxHandle,
  launchContext: LaunchContextOptions = {},
  deps?: CustomModeDeps,
): Promise<ModeLaunchResult> {
  const agent = launchContext.customAgent;
  if (!agent) {
    throw new Error("Custom agent configuration is required for ssh-custom mode.");
  }
  if (launchContext.prompt?.kind === "initial" && agent.initial_prompt_command === undefined) {
    throw new Error("Initial prompts for ssh-custom require agent.initial_prompt_command.");
  }
  if (launchContext.prompt?.kind === "follow-up" && agent.follow_up !== "tmux") {
    throw new Error('Follow-up prompts for ssh-custom require agent.follow_up = "tmux".');
  }

  const commandContext = resolveCommandContext(launchContext);
  const identity = getCustomAgentFingerprint(agent);
  const existingSession = await hasPersistentTmuxSession(handle, CUSTOM_TMUX_NAME, CUSTOM_TMUX_NAME);
  if (!existingSession) {
    await ensureCustomAgentAvailable(handle, agent, commandContext);
  }

  const result = await startTerminalAgent({
    handle,
    launchContext,
    ...(deps ? { deps } : {}),
    mode: "ssh-custom",
    executable: buildArgvCommand(agent.command),
    socketName: CUSTOM_TMUX_NAME,
    sessionName: CUSTOM_TMUX_NAME,
    ...(agent.initial_prompt_command ? { initialPromptCommand: agent.initial_prompt_command } : {}),
    followUpStrategy: agent.follow_up === "tmux" ? "tmux" : "unsupported",
    sessionRegistration: { identity },
  });
  return result;
}

async function ensureCustomAgentAvailable(
  handle: SandboxHandle,
  agent: ResolvedCustomAgentConfig,
  commandContext: { cwd?: string; envs: Record<string, string> },
): Promise<void> {
  if (agent.check_command === undefined) {
    return;
  }

  logger.verbose("Checking custom agent availability in sandbox.");
  const checkResult = await runConfiguredCommand(handle, agent.check_command, commandContext, COMMAND_TIMEOUT_MS);
  if (checkResult.exitCode === 0) {
    return;
  }

  if (agent.install_command === undefined) {
    throw new Error(
      "Custom agent is not available in the sandbox. Configure agent.install_command or install the agent in the sandbox and retry.",
    );
  }

  logger.verbose("Custom agent missing; running configured install command in sandbox.");
  const installResult = await runConfiguredCommand(handle, agent.install_command, commandContext, INSTALL_TIMEOUT_MS);
  if (installResult.exitCode !== 0) {
    throw new Error("Custom agent installation failed in the sandbox. Check agent.install_command and retry.");
  }

  logger.verbose("Custom agent install completed; verifying availability.");
  const verifyResult = await runConfiguredCommand(handle, agent.check_command, commandContext, COMMAND_TIMEOUT_MS);
  if (verifyResult.exitCode !== 0) {
    throw new Error("Custom agent installation completed but the configured check still fails in the sandbox.");
  }
}

async function runConfiguredCommand(
  handle: SandboxHandle,
  command: string,
  commandContext: { cwd?: string; envs: Record<string, string> },
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    return await handle.run(command, {
      ...(commandContext.cwd ? { cwd: commandContext.cwd } : {}),
      ...(Object.keys(commandContext.envs).length > 0 ? { envs: commandContext.envs } : {}),
      timeoutMs,
    });
  } catch (error) {
    const failedCommand = getFailedCommandResult(error);
    if (failedCommand) {
      return failedCommand;
    }
    throw error;
  }
}

function getFailedCommandResult(error: unknown): { stdout: string; stderr: string; exitCode: number } | undefined {
  if (!(error instanceof LauncherE2BLifecycleError)) {
    return undefined;
  }

  const cause = error.cause;
  if (typeof cause !== "object" || cause === null || !("result" in cause)) {
    return undefined;
  }

  const result = cause.result;
  if (typeof result !== "object" || result === null || !("exitCode" in result) || typeof result.exitCode !== "number") {
    return undefined;
  }

  return {
    stdout: "stdout" in result && typeof result.stdout === "string" ? result.stdout : "",
    stderr: "stderr" in result && typeof result.stderr === "string" ? result.stderr : "",
    exitCode: result.exitCode,
  };
}

function resolveCommandContext(launchContext: LaunchContextOptions): { cwd?: string; envs: Record<string, string> } {
  const cwd = launchContext.workingDirectory?.trim();
  return {
    ...(cwd ? { cwd } : {}),
    envs: launchContext.startupEnv ?? {},
  };
}
