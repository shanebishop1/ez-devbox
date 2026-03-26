import { type ListSandboxesOptions, listSandboxes, type SandboxListItem } from "../e2b/lifecycle.js";
import type { CommandResult } from "../types/index.js";
import { applyEnvDefaults } from "./env-defaults.js";
import { loadCliEnvSource } from "./env-source.js";
import { formatPromptSectionHeader } from "./prompt-style.js";
import { formatSandboxDisplayLabel } from "./sandbox-display-name.js";

export interface ListCommandDeps {
  listSandboxes: (options?: ListSandboxesOptions) => Promise<SandboxListItem[]>;
  resolveEnvSource?: () => Promise<Record<string, string | undefined>>;
}

const defaultDeps: ListCommandDeps = {
  listSandboxes,
  resolveEnvSource: loadCliEnvSource,
};

export async function runListCommand(_args: string[], deps: ListCommandDeps = defaultDeps): Promise<CommandResult> {
  const parsed = parseListArgs(_args);
  const envSource = deps.resolveEnvSource ? await deps.resolveEnvSource() : undefined;
  if (envSource) {
    applyEnvDefaults(process.env, envSource);
  }

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
    message: [formatPromptSectionHeader("SANDBOXES"), ...lines].join("\n"),
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
