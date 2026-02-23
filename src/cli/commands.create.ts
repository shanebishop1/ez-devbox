import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parse as parseDotEnv } from "dotenv";
import type { CommandResult } from "../types/index.js";
import type { StartupMode } from "../types/index.js";
import { loadConfig, type LoadConfigOptions } from "../config/load.js";
import { createSandbox, type CreateSandboxOptions, type SandboxHandle } from "../e2b/lifecycle.js";
import { resolveSandboxCreateEnv, type SandboxCreateEnvResolution } from "../e2b/env.js";
import { launchMode, resolveStartupMode, type ConcreteStartupMode, type ModeLaunchResult } from "../modes/index.js";
import { saveLastRunState, type LastRunState } from "../state/lastRun.js";
import {
  syncCodexAuthFile,
  syncCodexConfigDir,
  syncOpenCodeAuthFile,
  syncOpenCodeConfigDir,
  type PathSyncSummary,
  type ToolingSyncSummary
} from "../tooling/host-sandbox-sync.js";

export interface CreateCommandDeps {
  loadConfig: (options?: LoadConfigOptions) => ReturnType<typeof loadConfig>;
  createSandbox: (
    config: Awaited<ReturnType<typeof loadConfig>>,
    options?: CreateSandboxOptions
  ) => Promise<SandboxHandle>;
  resolveEnvSource: () => Promise<Record<string, string | undefined>>;
  resolveSandboxCreateEnv: (
    config: Awaited<ReturnType<typeof loadConfig>>,
    envSource?: Record<string, string | undefined>
  ) => SandboxCreateEnvResolution;
  launchMode: (handle: SandboxHandle, mode: StartupMode) => Promise<ModeLaunchResult>;
  syncToolingToSandbox: (
    config: Awaited<ReturnType<typeof loadConfig>>,
    sandbox: Pick<SandboxHandle, "writeFile">,
    mode: ConcreteStartupMode
  ) => Promise<ToolingSyncSummary>;
  saveLastRunState: (state: LastRunState) => Promise<void>;
  now: () => string;
}

const defaultDeps: CreateCommandDeps = {
  loadConfig,
  createSandbox,
  resolveEnvSource: loadEnvSource,
  resolveSandboxCreateEnv,
  launchMode,
  syncToolingToSandbox: syncToolingForMode,
  saveLastRunState,
  now: () => new Date().toISOString()
};

export async function runCreateCommand(args: string[], deps: CreateCommandDeps = defaultDeps): Promise<CommandResult> {
  const parsed = parseCreateArgs(args);
  const config = await deps.loadConfig();
  const mode = parsed.mode ?? config.startup.mode;
  const resolvedMode = resolveStartupMode(mode);
  const templateResolution = resolveTemplateForMode(config.sandbox.template, resolvedMode);
  const createConfig =
    templateResolution.template === config.sandbox.template
      ? config
      : {
          ...config,
          sandbox: {
            ...config.sandbox,
            template: templateResolution.template
          }
        };
  const envSource = await deps.resolveEnvSource();
  const envResolution = deps.resolveSandboxCreateEnv(config, envSource);

  const handle = await deps.createSandbox(createConfig, {
    envs: envResolution.envs
  });
  const syncSummary = await deps.syncToolingToSandbox(config, handle, resolvedMode);
  const launched = await deps.launchMode(handle, mode);

  await deps.saveLastRunState({
    sandboxId: handle.sandboxId,
    mode: launched.mode,
    updatedAt: deps.now()
  });

  const warningSuffix =
    envResolution.warnings.length === 0 ? "" : `\nMCP warnings:\n- ${envResolution.warnings.join("\n- ")}`;
  const templateSuffix =
    templateResolution.autoSelected
      ? `\nTemplate auto-selected for ${resolvedMode}: ${templateResolution.template}`
      : "";
  const syncSuffix = `\nTooling sync: ${formatToolingSyncSummary(syncSummary)}`;

  return {
    message: `Created sandbox ${handle.sandboxId}. ${launched.message}${templateSuffix}${syncSuffix}${warningSuffix}`,
    exitCode: 0
  };
}

async function syncToolingForMode(
  config: Awaited<ReturnType<typeof loadConfig>>,
  sandbox: Pick<SandboxHandle, "writeFile">,
  mode: ConcreteStartupMode
): Promise<ToolingSyncSummary> {
  if (mode === "ssh-opencode" || mode === "web") {
    const opencodeConfig = await syncOpenCodeConfigDir(config, sandbox);
    const opencodeAuth = await syncOpenCodeAuthFile(config, sandbox);
    return summarizeToolingSync(opencodeConfig, opencodeAuth, null, null);
  }

  if (mode === "ssh-codex") {
    const codexConfig = await syncCodexConfigDir(config, sandbox);
    const codexAuth = await syncCodexAuthFile(config, sandbox);
    return summarizeToolingSync(null, null, codexConfig, codexAuth);
  }

  const opencodeConfig = await syncOpenCodeConfigDir(config, sandbox);
  const opencodeAuth = await syncOpenCodeAuthFile(config, sandbox);
  const codexConfig = await syncCodexConfigDir(config, sandbox);
  const codexAuth = await syncCodexAuthFile(config, sandbox);
  return summarizeToolingSync(opencodeConfig, opencodeAuth, codexConfig, codexAuth);
}

function summarizeToolingSync(
  opencodeConfig: PathSyncSummary | null,
  opencodeAuth: PathSyncSummary | null,
  codexConfig: PathSyncSummary | null,
  codexAuth: PathSyncSummary | null
): ToolingSyncSummary {
  const summaries = [opencodeConfig, opencodeAuth, codexConfig, codexAuth].filter((item): item is PathSyncSummary => item !== null);

  return {
    totalDiscovered: summaries.reduce((total, item) => total + item.filesDiscovered, 0),
    totalWritten: summaries.reduce((total, item) => total + item.filesWritten, 0),
    skippedMissingPaths: summaries.reduce((total, item) => total + Number(item.skippedMissing), 0),
    opencodeConfigSynced: opencodeConfig !== null && !opencodeConfig.skippedMissing,
    opencodeAuthSynced: opencodeAuth !== null && !opencodeAuth.skippedMissing,
    codexConfigSynced: codexConfig !== null && !codexConfig.skippedMissing,
    codexAuthSynced: codexAuth !== null && !codexAuth.skippedMissing
  };
}

function formatToolingSyncSummary(summary: ToolingSyncSummary): string {
  const opencodeSynced = summary.opencodeConfigSynced || summary.opencodeAuthSynced;
  const codexSynced = summary.codexConfigSynced || summary.codexAuthSynced;
  return `discovered=${summary.totalDiscovered}, written=${summary.totalWritten}, missingPaths=${summary.skippedMissingPaths}, opencodeSynced=${opencodeSynced}, codexSynced=${codexSynced}`;
}

function resolveTemplateForMode(
  configuredTemplate: string,
  mode: "ssh-opencode" | "ssh-codex" | "web" | "ssh-shell"
): { template: string; autoSelected: boolean } {
  const normalized = configuredTemplate.trim();
  if (normalized !== "" && normalized !== "base") {
    return {
      template: configuredTemplate,
      autoSelected: false
    };
  }

  if (mode === "ssh-codex") {
    return {
      template: "codex",
      autoSelected: true
    };
  }

  return {
    template: "opencode",
    autoSelected: true
  };
}

async function loadEnvSource(): Promise<Record<string, string | undefined>> {
  const envPath = resolve(process.cwd(), ".env");

  let parsedFileEnv: Record<string, string | undefined> = {};

  try {
    parsedFileEnv = parseDotEnv(await readFile(envPath, "utf8"));
  } catch (error) {
    if (!isErrnoException(error) || error.code !== "ENOENT") {
      throw error;
    }
  }

  return {
    ...parsedFileEnv,
    ...process.env
  };
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === "object" && error !== null && "code" in error;
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
