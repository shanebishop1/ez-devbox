import type { ResolvedLauncherConfig } from "./schema.js";

export const defaultConfig: ResolvedLauncherConfig = {
  sandbox: {
    template: "base",
    reuse: true,
    timeoutMs: 30 * 60 * 1000
  },
  startup: {
    mode: "prompt"
  }
};
