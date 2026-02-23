export type ProjectSelectionMode = "single" | "all";

export function normalizeSelectionMode(mode: string): ProjectSelectionMode {
  if (mode === "single" || mode === "all") {
    return mode;
  }

  throw new Error(`Invalid project selection mode: ${mode}`);
}
