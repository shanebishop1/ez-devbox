import { type ListSandboxesOptions, listSandboxes, type SandboxListItem } from "../e2b/lifecycle.js";
import type { CommandResult } from "../types/index.js";
import { formatSandboxDisplayLabel } from "./sandbox-display-name.js";

export interface ListCommandDeps {
  listSandboxes: (options?: ListSandboxesOptions) => Promise<SandboxListItem[]>;
}

const defaultDeps: ListCommandDeps = {
  listSandboxes,
};

export async function runListCommand(_args: string[], deps: ListCommandDeps = defaultDeps): Promise<CommandResult> {
  const parsed = parseListArgs(_args);

  const sandboxes = await deps.listSandboxes();
  const formattedSandboxes = sandboxes.map((sandbox) => ({
    sandboxId: sandbox.sandboxId,
    label: formatSandboxDisplayLabel(sandbox.sandboxId, sandbox.metadata),
    state: sandbox.state,
    metadata: sandbox.metadata ?? {},
  }));

  if (parsed.json) {
    return {
      message: JSON.stringify({ sandboxes: formattedSandboxes }, null, 2),
      exitCode: 0,
    };
  }

  if (sandboxes.length === 0) {
    return {
      message: "No sandboxes found.",
      exitCode: 0,
    };
  }

  const lines = sandboxes.map((sandbox, index) => {
    const label = formatSandboxDisplayLabel(sandbox.sandboxId, sandbox.metadata);
    return `${index + 1}) ${label} [${sandbox.state}]`;
  });

  return {
    message: lines.join("\n"),
    exitCode: 0,
  };
}

function parseListArgs(args: string[]): { json: boolean } {
  let json = false;

  for (const token of args) {
    if (token === "--json") {
      json = true;
      continue;
    }

    if (token.startsWith("--")) {
      throw new Error(`Unknown option for list: '${token}'. Use --help for usage.`);
    }
    throw new Error(`Unexpected positional argument for list: '${token}'. Use --help for usage.`);
  }

  return { json };
}
