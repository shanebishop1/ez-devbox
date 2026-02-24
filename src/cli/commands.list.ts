import { listSandboxes, type ListSandboxesOptions, type SandboxListItem } from "../e2b/lifecycle.js";
import type { CommandResult } from "../types/index.js";
import { formatSandboxDisplayLabel } from "./sandbox-display-name.js";

export interface ListCommandDeps {
  listSandboxes: (options?: ListSandboxesOptions) => Promise<SandboxListItem[]>;
}

const defaultDeps: ListCommandDeps = {
  listSandboxes
};

export async function runListCommand(_args: string[], deps: ListCommandDeps = defaultDeps): Promise<CommandResult> {
  const sandboxes = await deps.listSandboxes();

  if (sandboxes.length === 0) {
    return {
      message: "No sandboxes found.",
      exitCode: 0
    };
  }

  const lines = sandboxes.map((sandbox, index) => {
    const label = formatSandboxDisplayLabel(sandbox.sandboxId, sandbox.metadata);
    return `${index + 1}) ${label} [${sandbox.state}]`;
  });

  return {
    message: lines.join("\n"),
    exitCode: 0
  };
}
