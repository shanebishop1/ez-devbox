import {
  killSandbox,
  type LifecycleOperationOptions,
  type ListSandboxesOptions,
  listSandboxes,
  type SandboxListItem,
} from "../e2b/lifecycle.js";
import { clearLastRunState, type LastRunState, loadLastRunState } from "../state/lastRun.js";
import type { CommandResult } from "../types/index.js";
import { applyEnvDefaults } from "./env-defaults.js";
import { loadCliEnvSource } from "./env-source.js";
import { promptWithReadline } from "./readline-prompt.js";
import { formatSandboxDisplayLabel } from "./sandbox-display-name.js";

export interface WipeCommandDeps {
  listSandboxes: (options?: ListSandboxesOptions) => Promise<SandboxListItem[]>;
  killSandbox: (sandboxId: string, options?: LifecycleOperationOptions) => Promise<void>;
  isInteractiveTerminal: () => boolean;
  promptInput: (question: string) => Promise<string>;
  loadLastRunState: () => Promise<LastRunState | null>;
  clearLastRunState: () => Promise<void>;
  resolveEnvSource?: () => Promise<Record<string, string | undefined>>;
}

const defaultDeps: WipeCommandDeps = {
  listSandboxes,
  killSandbox,
  isInteractiveTerminal: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
  promptInput,
  loadLastRunState,
  clearLastRunState,
  resolveEnvSource: loadCliEnvSource,
};

export async function runWipeCommand(args: string[], deps: WipeCommandDeps = defaultDeps): Promise<CommandResult> {
  const parsed = parseWipeArgs(args);
  const envSource = deps.resolveEnvSource ? await deps.resolveEnvSource() : undefined;
  if (envSource) {
    applyEnvDefaults(process.env, envSource);
  }
  const sandboxes = await deps.listSandboxes();

  const selected =
    parsed.sandboxId !== undefined
      ? (sandboxes.find((sandbox) => sandbox.sandboxId === parsed.sandboxId) ?? {
          sandboxId: parsed.sandboxId,
          state: "unknown",
        })
      : await selectSandboxInteractively(sandboxes, deps);

  const selectedLabel = formatSandboxDisplayLabel(selected.sandboxId, selected.metadata);
  await deps.killSandbox(selected.sandboxId);

  const lastRun = await deps.loadLastRunState();
  if (lastRun?.sandboxId === selected.sandboxId) {
    await deps.clearLastRunState();
  }

  return {
    message: `Wiped sandbox ${selectedLabel}.`,
    exitCode: 0,
  };
}

function parseWipeArgs(args: string[]): { sandboxId?: string } {
  let sandboxId: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];
    if (token === "--sandbox-id") {
      const next = args[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("Missing value for --sandbox-id.");
      }

      sandboxId = next;
      index += 1;
      continue;
    }

    if (token.startsWith("--")) {
      throw new Error(`Unknown option for wipe: '${token}'. Use --help for usage.`);
    }
    throw new Error(`Unexpected positional argument for wipe: '${token}'. Use --help for usage.`);
  }

  return { sandboxId };
}

async function selectSandboxInteractively(
  sandboxes: SandboxListItem[],
  deps: WipeCommandDeps,
): Promise<SandboxListItem> {
  if (!deps.isInteractiveTerminal()) {
    throw new Error("No --sandbox-id provided in a non-interactive terminal. Re-run with --sandbox-id <id>.");
  }

  if (sandboxes.length === 0) {
    throw new Error("No sandboxes are available to wipe.");
  }

  const choices = sandboxes.map(
    (sandbox, index) => `${index + 1}) ${formatSandboxDisplayLabel(sandbox.sandboxId, sandbox.metadata)}`,
  );
  const question = ["Select sandbox to wipe:", ...choices, "Enter choice number: "].join("\n");
  const answer = (await deps.promptInput(question)).trim();

  if (!/^\d+$/.test(answer)) {
    throw new Error(`Invalid selection '${answer}'. Enter a number between 1 and ${sandboxes.length}.`);
  }

  const selectedIndex = Number.parseInt(answer, 10) - 1;
  const selected = sandboxes[selectedIndex];
  if (!selected) {
    throw new Error(`Invalid selection '${answer}'. Enter a number between 1 and ${sandboxes.length}.`);
  }

  return selected;
}

async function promptInput(question: string): Promise<string> {
  return promptWithReadline(question);
}
