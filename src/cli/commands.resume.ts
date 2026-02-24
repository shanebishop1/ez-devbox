import { loadLastRunState, type LastRunState } from "../state/lastRun.js";
import type { CommandResult, StartupMode } from "../types/index.js";
import { runConnectCommand } from "./commands.connect.js";

export interface ResumeCommandDeps {
  loadLastRunState: () => Promise<LastRunState | null>;
  runConnectCommand: (args: string[]) => Promise<CommandResult>;
}

const defaultDeps: ResumeCommandDeps = {
  loadLastRunState,
  runConnectCommand
};

export async function runResumeCommand(args: string[], deps: ResumeCommandDeps = defaultDeps): Promise<CommandResult> {
  if (args.length > 0) {
    throw new Error(`Unexpected arguments for resume: ${args.join(" ")}.`);
  }

  const lastRun = await deps.loadLastRunState();
  if (!lastRun) {
    throw new Error("No last-run state found. Run 'ez-devbox create' or 'ez-devbox connect' first.");
  }

  const resumeMode = toConcreteStartupMode(lastRun.mode);
  return deps.runConnectCommand(["--sandbox-id", lastRun.sandboxId, "--mode", resumeMode]);
}

function toConcreteStartupMode(mode: StartupMode): Exclude<StartupMode, "prompt"> {
  return mode === "prompt" ? "ssh-opencode" : mode;
}
