import { createInterface } from "node:readline/promises";
import { killSandbox, listSandboxes, type LifecycleOperationOptions, type ListSandboxesOptions, type SandboxListItem } from "../e2b/lifecycle.js";
import type { CommandResult } from "../types/index.js";
import { clearLastRunState, loadLastRunState, type LastRunState } from "../state/lastRun.js";
import { formatSandboxDisplayLabel } from "./sandbox-display-name.js";

export interface WipeAllCommandDeps {
  listSandboxes: (options?: ListSandboxesOptions) => Promise<SandboxListItem[]>;
  killSandbox: (sandboxId: string, options?: LifecycleOperationOptions) => Promise<void>;
  isInteractiveTerminal: () => boolean;
  promptInput: (question: string) => Promise<string>;
  loadLastRunState: () => Promise<LastRunState | null>;
  clearLastRunState: () => Promise<void>;
}

const defaultDeps: WipeAllCommandDeps = {
  listSandboxes,
  killSandbox,
  isInteractiveTerminal: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
  promptInput,
  loadLastRunState,
  clearLastRunState
};

export async function runWipeAllCommand(args: string[], deps: WipeAllCommandDeps = defaultDeps): Promise<CommandResult> {
  const parsed = parseWipeAllArgs(args);
  const sandboxes = await deps.listSandboxes();

  if (sandboxes.length === 0) {
    return {
      message: "No sandboxes found. Nothing to wipe.",
      exitCode: 0
    };
  }

  if (!parsed.yes) {
    if (!deps.isInteractiveTerminal()) {
      throw new Error("wipe-all requires --yes in non-interactive terminals. Re-run with --yes.");
    }

    const answer = (await deps.promptInput(`Delete ${sandboxes.length} sandbox(s)? Type 'yes' or 'y' to confirm: `)).trim().toLowerCase();
    if (answer !== "yes" && answer !== "y") {
      return {
        message: "Wipe-all cancelled.",
        exitCode: 0
      };
    }
  }

  const deletedIds = new Set<string>();
  const deletedLabels: string[] = [];

  for (const sandbox of sandboxes) {
    await deps.killSandbox(sandbox.sandboxId);
    deletedIds.add(sandbox.sandboxId);
    deletedLabels.push(formatSandboxDisplayLabel(sandbox.sandboxId, sandbox.metadata));
  }

  const lastRun = await deps.loadLastRunState();
  if (lastRun?.sandboxId && deletedIds.has(lastRun.sandboxId)) {
    await deps.clearLastRunState();
  }

  const plural = sandboxes.length === 1 ? "sandbox" : "sandboxes";
  return {
    message: `Wiped ${sandboxes.length} ${plural}: ${deletedLabels.join(", ")}.`,
    exitCode: 0
  };
}

function parseWipeAllArgs(args: string[]): { yes: boolean } {
  return {
    yes: args.includes("--yes")
  };
}

async function promptInput(question: string): Promise<string> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    return await readline.question(question);
  } finally {
    readline.close();
  }
}
