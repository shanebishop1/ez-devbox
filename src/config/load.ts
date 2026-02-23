import type { ResolvedLauncherConfig } from "./schema.js";
import { defaultConfig } from "./defaults.js";

export async function loadConfig(): Promise<ResolvedLauncherConfig> {
  return defaultConfig;
}
