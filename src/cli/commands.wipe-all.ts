import {
  killSandbox,
  type LifecycleOperationOptions,
  type ListSandboxesOptions,
  listSandboxes,
  type SandboxListItem,
} from "../e2b/lifecycle.js";
import { clearLastRunState, type LastRunState, loadLastRunState } from "../state/lastRun.js";
import type { CommandResult } from "../types/index.js";
import { promptWithReadline } from "./readline-prompt.js";
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
  clearLastRunState,
};

export async function runWipeAllCommand(
  args: string[],
  deps: WipeAllCommandDeps = defaultDeps,
): Promise<CommandResult> {
  const parsed = parseWipeAllArgs(args);
  const sandboxes = await deps.listSandboxes();

  if (sandboxes.length === 0) {
    return {
      message: "No sandboxes found. Nothing to wipe.",
      exitCode: 0,
    };
  }

  if (!parsed.yes) {
    if (!deps.isInteractiveTerminal()) {
      throw new Error("wipe-all requires --yes in non-interactive terminals. Re-run with --yes.");
    }

    const answer = (await deps.promptInput(`Delete ${sandboxes.length} sandbox(s)? Type 'yes' or 'y' to confirm: `))
      .trim()
      .toLowerCase();
    if (answer !== "yes" && answer !== "y") {
      return {
        message: "Wipe-all cancelled.",
        exitCode: 0,
      };
    }
  }

  const deletedIds = new Set<string>();
  const deletedLabels: string[] = [];
  const failedLabels: string[] = [];

  for (const sandbox of sandboxes) {
    const label = formatSandboxDisplayLabel(sandbox.sandboxId, sandbox.metadata);
    try {
      await deps.killSandbox(sandbox.sandboxId);
      deletedIds.add(sandbox.sandboxId);
      deletedLabels.push(label);
    } catch (error) {
      failedLabels.push(`${label} (${toErrorMessage(error)})`);
    }
  }

  const lastRun = await deps.loadLastRunState();
  if (lastRun?.sandboxId && deletedIds.has(lastRun.sandboxId)) {
    await deps.clearLastRunState();
  }

  const messages: string[] = [];
  if (deletedLabels.length > 0) {
    const plural = deletedLabels.length === 1 ? "sandbox" : "sandboxes";
    messages.push(`Wiped ${deletedLabels.length} ${plural}: ${deletedLabels.join(", ")}.`);
  }
  if (failedLabels.length > 0) {
    const plural = failedLabels.length === 1 ? "sandbox" : "sandboxes";
    messages.push(`Failed to wipe ${failedLabels.length} ${plural}: ${failedLabels.join(", ")}.`);
  }

  if (messages.length === 0) {
    return {
      message: "No sandboxes were wiped.",
      exitCode: 0,
    };
  }

  return {
    message: messages.join("\n"),
    exitCode: failedLabels.length > 0 ? 1 : 0,
  };
}

function parseWipeAllArgs(args: string[]): { yes: boolean } {
  let yes = false;

  for (const token of args) {
    if (token === "--yes") {
      yes = true;
      continue;
    }

    if (token.startsWith("--")) {
      throw new Error(`Unknown option for wipe-all: '${token}'. Use --help for usage.`);
    }
    throw new Error(`Unexpected positional argument for wipe-all: '${token}'. Use --help for usage.`);
  }

  return { yes };
}

async function promptInput(question: string): Promise<string> {
  return promptWithReadline(question);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }

  return "unknown error";
}
