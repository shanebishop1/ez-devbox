import { resolve } from "node:path";
import { resolveLauncherConfigPath } from "./load.paths.js";
import { parseRawLauncherConfig } from "./load.raw-parse.js";
import { readEnvFile, readTomlConfig } from "./load.readers.js";
import type { LoadConfigOptions, LoadedLauncherConfig } from "./load.types.js";
import { assertRequiredE2BApiKey, validateResolvedLauncherConfig } from "./load.validation.js";
import type { ResolvedLauncherConfig } from "./schema.js";

export type { LoadConfigOptions, LoadedLauncherConfig } from "./load.types.js";

export async function loadConfig(options: LoadConfigOptions = {}): Promise<ResolvedLauncherConfig> {
  const loaded = await loadConfigWithMetadata(options);
  return loaded.config;
}

export async function loadConfigWithMetadata(options: LoadConfigOptions = {}): Promise<LoadedLauncherConfig> {
  const cwd = options.cwd ?? process.cwd();
  const resolvedPath = await resolveLauncherConfigPath(options);
  const configPath = resolvedPath.path;
  const envPath = options.envPath ?? resolve(cwd, ".env");

  const rawConfig = await readTomlConfig(configPath);
  const parsedEnv = await readEnvFile(envPath);
  const envSource = options.env ?? process.env;
  const mergedEnv = {
    ...parsedEnv,
    ...envSource,
  };

  assertRequiredE2BApiKey(mergedEnv);

  const resolved = parseRawLauncherConfig(rawConfig);
  validateResolvedLauncherConfig(resolved);

  return {
    config: resolved,
    configPath,
    createdConfig: resolvedPath.created,
    scope: resolvedPath.scope,
  };
}
