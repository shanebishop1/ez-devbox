import { createInterface } from "node:readline/promises";
import { normalizePromptCancelledError } from "../cli/prompt-cancelled.js";
import { formatPromptChoice, formatPromptSectionHeader } from "../cli/prompt-style.js";
import type { ResolvedLauncherConfig, ResolvedProjectRepoConfig } from "../config/schema.js";
import { selectReposForProvisioning } from "../repo/selection.js";

export interface SelectReposOptions {
  isInteractiveTerminal?: () => boolean;
  promptInput?: (question: string) => Promise<string>;
  preferredActiveRepo?: string;
  activeName: string | undefined;
  activeIndex: number | undefined;
}

export async function selectRepos(
  repos: ResolvedProjectRepoConfig[],
  mode: ResolvedLauncherConfig["project"]["mode"],
  active: ResolvedLauncherConfig["project"]["active"],
  options: SelectReposOptions,
): Promise<ResolvedProjectRepoConfig[]> {
  if (repos.length === 0) {
    return [];
  }

  if (mode === "all") {
    return [...repos];
  }

  if (repos.length === 1) {
    return [repos[0]];
  }

  if (active === "name" || active === "index") {
    return selectReposForProvisioning({
      mode,
      active,
      repos,
      activeName: options.activeName,
      activeIndex: options.activeIndex,
    });
  }

  const preferredActiveRepo = options.preferredActiveRepo?.trim();
  if (preferredActiveRepo) {
    const preferredRepo = repos.find((repo) => repo.name === preferredActiveRepo);
    if (preferredRepo) {
      return [preferredRepo];
    }
  }

  const isInteractiveTerminal =
    options.isInteractiveTerminal ?? (() => Boolean(process.stdin.isTTY && process.stdout.isTTY));
  if (!isInteractiveTerminal()) {
    return selectReposForProvisioning({
      mode,
      active,
      repos,
      promptIndex: 0,
    });
  }

  const prompt = options.promptInput ?? promptInput;
  const question = [
    formatPromptSectionHeader("Multiple repos available. Select one:"),
    ...repos.map((repo, index) => formatPromptChoice(index + 1, repo.name)),
    "",
    `Enter choice [1-${repos.length}]: `,
  ].join("\n");
  const selectedIndex = Number.parseInt((await prompt(question)).trim(), 10);
  const selected = Number.isNaN(selectedIndex) ? undefined : repos[selectedIndex - 1];
  if (!selected) {
    throw new Error(`Invalid repo selection. Enter a number between 1 and ${repos.length}.`);
  }

  return selectReposForProvisioning({
    mode,
    active,
    repos,
    promptIndex: selectedIndex - 1,
  });
}

async function promptInput(question: string): Promise<string> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    return await readline.question(question);
  } catch (error) {
    const cancelledError = normalizePromptCancelledError(error, "Repository selection cancelled.");
    if (cancelledError) {
      throw cancelledError;
    }
    throw error;
  } finally {
    readline.close();
  }
}
