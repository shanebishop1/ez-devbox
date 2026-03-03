import type { ResolvedLauncherConfig } from "./schema.js";

export type JsonRecord = Record<string, unknown>;

export interface LoadConfigOptions {
  configPath?: string;
  envPath?: string;
  cwd?: string;
  isInteractiveTerminal?: () => boolean;
  promptInput?: (question: string) => Promise<string>;
  platform?: NodeJS.Platform;
  homeDir?: string;
  env?: NodeJS.ProcessEnv;
}

export interface LoadedLauncherConfig {
  config: ResolvedLauncherConfig;
  configPath: string;
  createdConfig: boolean;
  scope: "local" | "global";
}
