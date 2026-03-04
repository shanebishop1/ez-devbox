import type { SandboxListItem } from "../e2b/lifecycle.js";
import type { LastRunState } from "../state/lastRun.js";
import { formatPromptChoice } from "./prompt-style.js";
import { promptWithReadline } from "./readline-prompt.js";
import { formatSandboxDisplayLabel } from "./sandbox-display-name.js";

interface CommandTargetDeps {
  listSandboxes: () => Promise<SandboxListItem[]>;
  loadLastRunState: () => Promise<LastRunState | null>;
  isInteractiveTerminal?: () => boolean;
  promptInput?: (question: string) => Promise<string>;
}

export async function resolveSandboxTarget(
  sandboxIdArg: string | undefined,
  deps: CommandTargetDeps,
): Promise<{ sandboxId: string; label?: string }> {
  if (sandboxIdArg) {
    return { sandboxId: sandboxIdArg };
  }

  const sandboxes = await deps.listSandboxes();
  const firstSandbox = sandboxes[0];
  if (!firstSandbox) {
    throw new Error(
      "No sandboxes are available. Create one with 'ez-devbox create' or pass --sandbox-id <sandbox-id>.",
    );
  }

  if (sandboxes.length === 1) {
    const label = formatSandboxDisplayLabel(firstSandbox.sandboxId, firstSandbox.metadata);
    return {
      sandboxId: firstSandbox.sandboxId,
      label: label === firstSandbox.sandboxId ? undefined : label,
    };
  }

  const isInteractiveTerminal =
    deps.isInteractiveTerminal ?? (() => Boolean(process.stdin.isTTY && process.stdout.isTTY));
  if (isInteractiveTerminal()) {
    return promptForSandboxSelection(sandboxes, deps.promptInput);
  }

  const lastRun = await deps.loadLastRunState();
  const matched =
    lastRun?.sandboxId === undefined ? undefined : sandboxes.find((sandbox) => sandbox.sandboxId === lastRun.sandboxId);
  if (matched) {
    const label = formatSandboxDisplayLabel(matched.sandboxId, matched.metadata);
    return {
      sandboxId: matched.sandboxId,
      label: label === matched.sandboxId ? undefined : label,
    };
  }

  throw new Error(
    "Multiple sandboxes are available but no interactive terminal was detected. Re-run with --sandbox-id <sandbox-id>.",
  );
}

async function promptForSandboxSelection(
  sandboxes: SandboxListItem[],
  promptInput?: (question: string) => Promise<string>,
): Promise<{ sandboxId: string; label?: string }> {
  const prompt = promptInput ?? ((question: string) => promptWithReadline(question));
  const options = sandboxes.map((sandbox, index) => {
    const label = formatSandboxDisplayLabel(sandbox.sandboxId, sandbox.metadata);
    return {
      index: index + 1,
      sandboxId: sandbox.sandboxId,
      label,
    };
  });

  const question = [
    "Multiple sandboxes available. Select one:",
    ...options.map((option) => formatPromptChoice(option.index, option.label)),
    `Enter choice [1-${options.length}]: `,
  ].join("\n");
  const selectedIndex = Number.parseInt((await prompt(question)).trim(), 10);
  const selected = Number.isNaN(selectedIndex) ? undefined : options[selectedIndex - 1];
  if (!selected) {
    throw new Error(
      `Invalid sandbox selection. Enter a number between 1 and ${options.length}, or use --sandbox-id <sandbox-id>.`,
    );
  }

  return {
    sandboxId: selected.sandboxId,
    label: selected.label === selected.sandboxId ? undefined : selected.label,
  };
}
