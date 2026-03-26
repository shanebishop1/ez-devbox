import { logger } from "../logging/logger.js";
import { type LastRunState, loadLastRunState } from "../state/lastRun.js";
import type { CommandResult, StartupMode } from "../types/index.js";
import { type ConnectCommandOptions, runConnectCommand } from "./commands.connect.js";
import { renderPromptWizardHeader, SSH_SUSPEND_RESUME_HINT } from "./prompt-style.js";

export interface ResumeCommandDeps {
  loadLastRunState: () => Promise<LastRunState | null>;
  runConnectCommand: (args: string[], options?: ConnectCommandOptions) => Promise<CommandResult>;
}

const defaultDeps: ResumeCommandDeps = {
  loadLastRunState,
  runConnectCommand: (connectArgs, options) => runConnectCommand(connectArgs, undefined, options),
};

export async function runResumeCommand(args: string[], deps: ResumeCommandDeps = defaultDeps): Promise<CommandResult> {
  if (args.length > 0) {
    if (args[0].startsWith("--")) {
      throw new Error(`Unknown option for resume: '${args[0]}'. Use --help for usage.`);
    }
    throw new Error(`Unexpected positional argument for resume: '${args[0]}'. Use --help for usage.`);
  }

  if (process.stdin.isTTY && process.stdout.isTTY) {
    process.stdout.write(`${renderPromptWizardHeader("ez-devbox")}\n\n`);
  }

  const lastRun = await deps.loadLastRunState();
  if (!lastRun) {
    throw new Error("No last-run state found. Run 'ez-devbox create' or 'ez-devbox connect' first.");
  }

  const resumeMode = toConcreteStartupMode(lastRun.mode);
  logger.info(SSH_SUSPEND_RESUME_HINT);
  if (process.stdin.isTTY && process.stdout.isTTY) {
    process.stdout.write("\n");
  }
  logger.info(`Resuming ${resumeMode} session${lastRun.activeRepo ? ` with ${lastRun.activeRepo} repo.` : "."}`);
  if (process.stdin.isTTY && process.stdout.isTTY) {
    process.stdout.write("\n");
  }
  return deps.runConnectCommand(["--sandbox-id", lastRun.sandboxId, "--mode", resumeMode], {
    skipDetachHint: true,
    skipInteractiveHeader: true,
  });
}

function toConcreteStartupMode(mode: StartupMode): Exclude<StartupMode, "prompt"> {
  return mode === "prompt" ? "ssh-opencode" : mode;
}
