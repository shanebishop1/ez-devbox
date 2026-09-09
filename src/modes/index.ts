import type { ResolvedCustomAgentConfig } from "../config/schema.js";
import type { SandboxHandle } from "../e2b/lifecycle.js";
import type { StartupMode } from "../types/index.js";
import { startClaudeMode } from "./claude.js";
import { startCodexMode } from "./codex.js";
import { startCustomMode } from "./custom.js";
import { startOpenCodeMode } from "./opencode.js";
import { startShellMode } from "./shell.js";
import type { TmuxConnectionInfo } from "./tmux.js";
import { startWebMode } from "./web.js";

export const supportedModes: StartupMode[] = [
  "prompt",
  "ssh-opencode",
  "ssh-codex",
  "ssh-claude",
  "web",
  "ssh-shell",
  "ssh-custom",
];

export type ConcreteStartupMode = Exclude<StartupMode, "prompt">;

export interface ModeLaunchResult {
  mode: ConcreteStartupMode;
  message: string;
  command?: string;
  url?: string;
  details?: Record<string, unknown>;
  readiness?: "ready";
  attachment?: "detached" | "completed" | "not-applicable";
  connection?: TmuxConnectionInfo | { type: "http"; endpoint: string };
}

export interface LaunchPrompt {
  kind: "initial" | "follow-up";
  text: string;
}

export interface LaunchContextOptions {
  workingDirectory?: string;
  startupEnv?: Record<string, string>;
  nonInteractive?: boolean;
  detach?: boolean;
  prompt?: LaunchPrompt;
  onBeforeInteractiveSession?: () => void;
  onLaunchStageUpdate?: (loadingMessage: string, completionMessage: string) => void;
  matchLocalOpenCodeVersion?: boolean;
  customAgent?: ResolvedCustomAgentConfig;
}

export interface LaunchModeOptions {
  promptFallbackMode?: ConcreteStartupMode;
  workingDirectory?: string;
  startupEnv?: Record<string, string>;
  nonInteractive?: boolean;
  detach?: boolean;
  prompt?: LaunchPrompt;
  onBeforeInteractiveSession?: () => void;
  onLaunchStageUpdate?: (loadingMessage: string, completionMessage: string) => void;
  matchLocalOpenCodeVersion?: boolean;
  customAgent?: ResolvedCustomAgentConfig;
}

type ConcreteModeRunner = (handle: SandboxHandle, options?: LaunchContextOptions) => Promise<ModeLaunchResult>;

const DEFAULT_PROMPT_FALLBACK_MODE: ConcreteStartupMode = "ssh-opencode";

const MODE_RUNNERS: Record<ConcreteStartupMode, ConcreteModeRunner> = {
  "ssh-opencode": startOpenCodeMode,
  "ssh-codex": startCodexMode,
  "ssh-claude": startClaudeMode,
  "ssh-shell": startShellMode,
  "ssh-custom": startCustomMode,
  web: startWebMode,
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
  options: LaunchModeOptions = {},
): Promise<ModeLaunchResult> {
  const {
    promptFallbackMode,
    workingDirectory,
    startupEnv,
    nonInteractive,
    detach,
    prompt,
    onBeforeInteractiveSession,
    onLaunchStageUpdate,
    matchLocalOpenCodeVersion,
    customAgent,
  } = options;
  const resolvedMode = resolveStartupMode(mode, { promptFallbackMode });
  return MODE_RUNNERS[resolvedMode](handle, {
    workingDirectory,
    startupEnv,
    nonInteractive,
    detach,
    prompt,
    onBeforeInteractiveSession,
    onLaunchStageUpdate,
    matchLocalOpenCodeVersion,
    customAgent,
  });
}
