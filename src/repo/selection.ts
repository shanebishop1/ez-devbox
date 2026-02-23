export type ProjectSelectionMode = "single" | "all";
export type ProjectActiveMode = "prompt" | "name" | "index";

export interface SelectReposInput<TRepo extends { name: string }> {
  mode: ProjectSelectionMode;
  active: ProjectActiveMode;
  repos: TRepo[];
  activeName?: string;
  activeIndex?: number;
  promptIndex?: number;
}

export function selectReposForProvisioning<TRepo extends { name: string }>(input: SelectReposInput<TRepo>): TRepo[] {
  const { mode, active, repos } = input;

  if (repos.length === 0) {
    return [];
  }

  if (mode === "all") {
    return [...repos];
  }

  if (active === "name") {
    const selectedName = input.activeName?.trim();
    if (!selectedName) {
      throw new Error("Invalid active repo name: value is required when project.active is 'name'.");
    }

    const repo = repos.find((entry) => entry.name === selectedName);
    if (!repo) {
      throw new Error(
        `Invalid active repo name '${selectedName}': not found. Available repos: ${repos.map((entry) => entry.name).join(", ")}.`
      );
    }

    return [repo];
  }

  if (active === "index") {
    return [repos[resolveRepoIndex(input.activeIndex, repos.length, "activeIndex")]];
  }

  return [repos[resolveRepoIndex(input.promptIndex, repos.length, "promptIndex")]];
}

export function normalizeSelectionMode(mode: string): ProjectSelectionMode {
  if (mode === "single" || mode === "all") {
    return mode;
  }

  throw new Error(`Invalid project selection mode: ${mode}`);
}

function resolveRepoIndex(index: number | undefined, length: number, source: "activeIndex" | "promptIndex"): number {
  if (!Number.isInteger(index)) {
    throw new Error(`Invalid ${source}: expected an integer.`);
  }

  if ((index as number) < 0 || (index as number) >= length) {
    throw new Error(`Invalid ${source}: index ${(index as number).toString()} is out of range (expected 0-${length - 1}).`);
  }

  return index as number;
}
