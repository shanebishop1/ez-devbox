import type { loadConfig } from "../config/load.js";
import type { SandboxListItem } from "../e2b/lifecycle.js";
import { logger } from "../logging/logger.js";
import type { LastRunState } from "../state/lastRun.js";
import { formatPromptChoice, formatPromptSectionHeader } from "./prompt-style.js";
import { promptWithReadline } from "./readline-prompt.js";
import { formatSandboxDisplayLabel } from "./sandbox-display-name.js";

interface ConnectTargetDeps {
  listSandboxes: () => Promise<SandboxListItem[]>;
  loadLastRunState: () => Promise<LastRunState | null>;
  isInteractiveTerminal?: () => boolean;
  promptInput?: (question: string) => Promise<string>;
}

interface ConnectCommandOptions {
  skipLastRun?: boolean;
}

export async function resolvePreferredActiveRepo(
  config: Awaited<ReturnType<typeof loadConfig>>,
  targetSandboxId: string,
  deps: Pick<ConnectTargetDeps, "loadLastRunState">,
  options: ConnectCommandOptions,
): Promise<string | undefined> {
  if (options.skipLastRun) {
    return undefined;
  }

  if (config.project.mode !== "single" || config.project.active !== "prompt" || config.project.repos.length <= 1) {
    return undefined;
  }

  const lastRun = await deps.loadLastRunState();
  if (!lastRun || lastRun.sandboxId !== targetSandboxId) {
    return undefined;
  }

  const preferred = lastRun.activeRepo?.trim();
  return preferred ? preferred : undefined;
}

export async function resolveSandboxTarget(
  sandboxIdArg: string | undefined,
  deps: ConnectTargetDeps,
  options: ConnectCommandOptions,
): Promise<{ sandboxId: string; label?: string }> {
  if (sandboxIdArg) {
    return { sandboxId: sandboxIdArg };
  }

  const sandboxes = await deps.listSandboxes();
  const firstSandbox = sandboxes[0];
  if (!firstSandbox) {
    throw new Error("No sandboxes are available to connect.");
  }

  if (sandboxes.length === 1) {
    const fallbackLabel = formatSandboxDisplayLabel(firstSandbox.sandboxId, firstSandbox.metadata);
    if (fallbackLabel !== firstSandbox.sandboxId) {
      logger.verbose(`Selected fallback sandbox: ${fallbackLabel}.`);
    }

    return {
      sandboxId: firstSandbox.sandboxId,
      label: fallbackLabel === firstSandbox.sandboxId ? undefined : fallbackLabel,
    };
  }

  const isInteractiveTerminal =
    deps.isInteractiveTerminal ?? (() => Boolean(process.stdin.isTTY && process.stdout.isTTY));
  if (isInteractiveTerminal()) {
    return promptForSandboxTargetSelection(sandboxes, deps.promptInput);
  }

  if (!options.skipLastRun) {
    const lastRun = await deps.loadLastRunState();
    const matchedSandbox =
      lastRun?.sandboxId === undefined
        ? undefined
        : sandboxes.find((sandbox) => sandbox.sandboxId === lastRun.sandboxId);
    if (matchedSandbox) {
      const fallbackLabel = formatSandboxDisplayLabel(matchedSandbox.sandboxId, matchedSandbox.metadata);
      if (fallbackLabel !== matchedSandbox.sandboxId) {
        logger.verbose(`Selected fallback sandbox: ${fallbackLabel}.`);
      }

      return {
        sandboxId: matchedSandbox.sandboxId,
        label: fallbackLabel === matchedSandbox.sandboxId ? undefined : fallbackLabel,
      };
    }
  }

  throw new Error(
    "Multiple sandboxes are available but no interactive terminal was detected. Re-run with --sandbox-id <sandbox-id>.",
  );
}

async function promptForSandboxTargetSelection(
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
    formatPromptSectionHeader("Multiple sandboxes available. Select one:"),
    ...options.map((option) => formatPromptChoice(option.index, option.label)),
    "",
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
