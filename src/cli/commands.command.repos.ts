import { posix } from "node:path";
import type { loadConfig } from "../config/load.js";
import { selectReposForProvisioning } from "../repo/selection.js";
import { formatPromptChoice, formatPromptSectionHeader } from "./prompt-style.js";
import { promptWithReadline } from "./readline-prompt.js";

interface RepoSelectionDeps {
  isInteractiveTerminal?: () => boolean;
  promptInput?: (question: string) => Promise<string>;
}

export async function resolveSelectedRepos(
  repos: Awaited<ReturnType<typeof loadConfig>>["project"]["repos"],
  mode: Awaited<ReturnType<typeof loadConfig>>["project"]["mode"],
  active: Awaited<ReturnType<typeof loadConfig>>["project"]["active"],
  activeName: string | undefined,
  activeIndex: number | undefined,
  deps: RepoSelectionDeps,
): Promise<Awaited<ReturnType<typeof loadConfig>>["project"]["repos"]> {
  if (repos.length === 0) {
    return [];
  }

  if (mode === "all") {
    return [...repos];
  }

  if (repos.length === 1) {
    return [repos[0]];
  }

  const isInteractiveTerminal =
    deps.isInteractiveTerminal ?? (() => Boolean(process.stdin.isTTY && process.stdout.isTTY));
  if (active === "prompt" && isInteractiveTerminal()) {
    const prompt = deps.promptInput ?? ((question: string) => promptWithReadline(question));
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

  if (active === "prompt") {
    return selectReposForProvisioning({
      mode,
      active,
      repos,
      promptIndex: 0,
    });
  }

  return selectReposForProvisioning({
    mode,
    active,
    repos,
    activeName,
    activeIndex,
  });
}

export function resolveCommandWorkingDirectory(
  projectDir: string,
  selectedRepos: Awaited<ReturnType<typeof loadConfig>>["project"]["repos"],
): string {
  if (selectedRepos.length === 1) {
    return posix.join(projectDir, selectedRepos[0].name);
  }

  return projectDir;
}
