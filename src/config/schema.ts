import type { StartupMode } from "../types/index.js";

export interface ResolvedLauncherConfig {
  sandbox: {
    template: string;
    reuse: boolean;
    timeoutMs: number;
  };
  startup: {
    mode: StartupMode;
  };
}
