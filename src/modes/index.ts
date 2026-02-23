import type { StartupMode } from "../types/index.js";
import type { SandboxHandle } from "../e2b/lifecycle.js";
import { startCodexMode } from "./codex.js";
import { startOpenCodeMode } from "./opencode.js";
import { startShellMode } from "./shell.js";
import { startWebMode } from "./web.js";

export const supportedModes: StartupMode[] = ["prompt", "ssh-opencode", "ssh-codex", "web", "ssh-shell"];

export type ConcreteStartupMode = Exclude<StartupMode, "prompt">;

export interface ModeLaunchResult {
  mode: ConcreteStartupMode;
  message: string;
  command?: string;
  url?: string;
  details?: Record<string, string | number | boolean>;
}

export interface LaunchModeOptions {
  promptFallbackMode?: ConcreteStartupMode;
}

type ConcreteModeRunner = (handle: SandboxHandle) => Promise<ModeLaunchResult>;

const DEFAULT_PROMPT_FALLBACK_MODE: ConcreteStartupMode = "ssh-opencode";

const MODE_RUNNERS: Record<ConcreteStartupMode, ConcreteModeRunner> = {
  "ssh-opencode": startOpenCodeMode,
  "ssh-codex": startCodexMode,
  "ssh-shell": startShellMode,
  web: startWebMode
};

export function resolveStartupMode(mode: StartupMode, options: LaunchModeOptions = {}): ConcreteStartupMode {
  if (mode === "prompt") {
    return options.promptFallbackMode ?? DEFAULT_PROMPT_FALLBACK_MODE;
  }

  return mode;
}

export async function launchMode(
  handle: SandboxHandle,
  mode: StartupMode,
  options: LaunchModeOptions = {}
): Promise<ModeLaunchResult> {
  const resolvedMode = resolveStartupMode(mode, options);
  return MODE_RUNNERS[resolvedMode](handle);
}
