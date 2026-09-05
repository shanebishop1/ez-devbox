import type { LoadConfigOptions, loadConfig, loadConfigWithMetadata } from "../config/load.js";
import type { SandboxCreateEnvResolution } from "../e2b/env.js";
import type {
  LifecycleOperationOptions,
  ListSandboxesOptions,
  SandboxHandle,
  SandboxListItem,
} from "../e2b/lifecycle.js";
import type { ModeLaunchResult } from "../modes/index.js";
import type { BootstrapProjectWorkspaceResult } from "../project/bootstrap.js";
import type { LastRunState } from "../state/lastRun.js";
import type { StartupMode } from "../types/index.js";
import type { StartupModePromptDeps } from "./startup-mode-prompt.js";

export interface ConnectCommandDeps {
  loadConfig: (options?: LoadConfigOptions) => ReturnType<typeof loadConfig>;
  loadConfigWithMetadata?: (options?: LoadConfigOptions) => ReturnType<typeof loadConfigWithMetadata>;
  connectSandbox: (
    sandboxId: string,
    config: Awaited<ReturnType<typeof loadConfig>>,
    options?: LifecycleOperationOptions,
  ) => Promise<SandboxHandle>;
  loadLastRunState: () => Promise<LastRunState | null>;
  listSandboxes: (options?: ListSandboxesOptions) => Promise<SandboxListItem[]>;
  resolvePromptStartupMode: (requestedMode: StartupMode, deps?: StartupModePromptDeps) => Promise<StartupMode>;
  launchMode: (
    handle: SandboxHandle,
    mode: StartupMode,
    options?: {
      workingDirectory?: string;
      startupEnv?: Record<string, string>;
      nonInteractive?: boolean;
      detach?: boolean;
      prompt?: { kind: "initial" | "follow-up"; text: string };
      matchLocalOpenCodeVersion?: boolean;
      onBeforeInteractiveSession?: () => void;
    },
  ) => Promise<ModeLaunchResult>;
  resolveEnvSource?: () => Promise<Record<string, string | undefined>>;
  resolveSandboxCreateEnv?: (
    config: Awaited<ReturnType<typeof loadConfig>>,
    envSource?: Record<string, string | undefined>,
  ) => SandboxCreateEnvResolution;
  resolveHostGhToken?: (env: NodeJS.ProcessEnv) => Promise<string | undefined>;
  bootstrapProjectWorkspace?: (
    handle: SandboxHandle,
    config: Awaited<ReturnType<typeof loadConfig>>,
    options?: {
      isConnect?: boolean;
      isInteractiveTerminal?: () => boolean;
      runtimeEnv?: Record<string, string>;
      onProgress?: (message: string) => void;
    },
  ) => Promise<BootstrapProjectWorkspaceResult>;
  saveLastRunState: (state: LastRunState) => Promise<void>;
  isInteractiveTerminal?: () => boolean;
  promptInput?: (question: string) => Promise<string>;
  now: () => string;
}
