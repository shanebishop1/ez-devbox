import type { CommandResult } from "../types/index.js";
import type { StartupMode } from "../types/index.js";
import { loadConfig, type LoadConfigOptions } from "../config/load.js";
import { createSandbox, type CreateSandboxOptions, type SandboxHandle } from "../e2b/lifecycle.js";
import { launchMode, type ModeLaunchResult } from "../modes/index.js";
import { saveLastRunState, type LastRunState } from "../state/lastRun.js";

export interface CreateCommandDeps {
  loadConfig: (options?: LoadConfigOptions) => ReturnType<typeof loadConfig>;
  createSandbox: (
    config: Awaited<ReturnType<typeof loadConfig>>,
    options?: CreateSandboxOptions
  ) => Promise<SandboxHandle>;
  launchMode: (handle: SandboxHandle, mode: StartupMode) => Promise<ModeLaunchResult>;
  saveLastRunState: (state: LastRunState) => Promise<void>;
  now: () => string;
}

const defaultDeps: CreateCommandDeps = {
  loadConfig,
  createSandbox,
  launchMode,
  saveLastRunState,
  now: () => new Date().toISOString()
};

export async function runCreateCommand(args: string[], deps: CreateCommandDeps = defaultDeps): Promise<CommandResult> {
  const parsed = parseCreateArgs(args);
  const config = await deps.loadConfig();
  const mode = parsed.mode ?? config.startup.mode;

  const handle = await deps.createSandbox(config);
  const launched = await deps.launchMode(handle, mode);

  await deps.saveLastRunState({
    sandboxId: handle.sandboxId,
    mode: launched.mode,
    updatedAt: deps.now()
  });

  return {
    message: `Created sandbox ${handle.sandboxId}. ${launched.message}`,
    exitCode: 0
  };
}

function parseCreateArgs(args: string[]): { mode?: StartupMode } {
  let mode: StartupMode | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (token === "--mode") {
      const next = args[index + 1];
      if (!isStartupMode(next)) {
        throw new Error("Invalid value for --mode. Expected one of prompt|ssh-opencode|ssh-codex|web|ssh-shell.");
      }

      mode = next;
      index += 1;
    }
  }

  return { mode };
}

function isStartupMode(value: string | undefined): value is StartupMode {
  return value === "prompt" || value === "ssh-opencode" || value === "ssh-codex" || value === "web" || value === "ssh-shell";
}
