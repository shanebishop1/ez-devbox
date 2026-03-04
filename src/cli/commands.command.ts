import { type LoadConfigOptions, loadConfig, loadConfigWithMetadata } from "../config/load.js";
import { resolveSandboxCreateEnv, type SandboxCreateEnvResolution } from "../e2b/env.js";
import {
  connectSandbox,
  type LifecycleOperationOptions,
  type ListSandboxesOptions,
  listSandboxes,
  type SandboxHandle,
  type SandboxListItem,
} from "../e2b/lifecycle.js";
import { logger } from "../logging/logger.js";
import { type LastRunState, loadLastRunState } from "../state/lastRun.js";
import { withConfiguredTunnel } from "../tunnel/cloudflared.js";
import type { CommandResult } from "../types/index.js";
import { parseCommandArgs } from "./commands.command.args.js";
import { withoutOpenCodeServerPassword } from "./commands.command.env.js";
import { resolveCommandWorkingDirectory, resolveSelectedRepos } from "./commands.command.repos.js";
import { resolveSandboxTarget } from "./commands.command.target.js";
import { loadCliEnvSource } from "./env-source.js";

export interface CommandCommandDeps {
  loadConfig: (options?: LoadConfigOptions) => ReturnType<typeof loadConfig>;
  loadConfigWithMetadata?: (options?: LoadConfigOptions) => ReturnType<typeof loadConfigWithMetadata>;
  listSandboxes: (options?: ListSandboxesOptions) => Promise<SandboxListItem[]>;
  connectSandbox: (
    sandboxId: string,
    config: Awaited<ReturnType<typeof loadConfig>>,
    options?: LifecycleOperationOptions,
  ) => Promise<SandboxHandle>;
  resolveEnvSource?: () => Promise<Record<string, string | undefined>>;
  resolveSandboxCreateEnv?: (
    config: Awaited<ReturnType<typeof loadConfig>>,
    envSource?: Record<string, string | undefined>,
  ) => SandboxCreateEnvResolution;
  loadLastRunState: () => Promise<LastRunState | null>;
  isInteractiveTerminal?: () => boolean;
  promptInput?: (question: string) => Promise<string>;
}

const defaultDeps: CommandCommandDeps = {
  loadConfig,
  loadConfigWithMetadata,
  listSandboxes,
  connectSandbox,
  resolveEnvSource: loadCliEnvSource,
  resolveSandboxCreateEnv,
  loadLastRunState,
  isInteractiveTerminal: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
};

export async function runCommandCommand(
  args: string[],
  deps: CommandCommandDeps = defaultDeps,
): Promise<CommandResult> {
  const parsed = parseCommandArgs(args);
  const loadedConfig = deps.loadConfigWithMetadata ? await deps.loadConfigWithMetadata() : undefined;
  const config = loadedConfig ? loadedConfig.config : await deps.loadConfig();
  if (loadedConfig) {
    logger.info(`Using launcher config: ${loadedConfig.configPath}`);
  }
  return withConfiguredTunnel(config, async (tunnelRuntimeEnv) => {
    const sandboxTarget = await resolveSandboxTarget(parsed.sandboxId, deps);
    const selectedRepos = await resolveSelectedRepos(
      config.project.repos,
      config.project.mode,
      config.project.active,
      config.project.active_name,
      config.project.active_index,
      deps,
    );
    const cwd = resolveCommandWorkingDirectory(config.project.dir, selectedRepos);
    const envSource = deps.resolveEnvSource ? await deps.resolveEnvSource() : {};
    const envResolution = deps.resolveSandboxCreateEnv
      ? deps.resolveSandboxCreateEnv(config, envSource)
      : {
          envs: {},
        };
    const runtimeEnv = withoutOpenCodeServerPassword({
      ...envResolution.envs,
      ...tunnelRuntimeEnv,
    });

    const handle = await deps.connectSandbox(sandboxTarget.sandboxId, config);
    const result = await handle.run(parsed.command, {
      cwd,
      ...(Object.keys(runtimeEnv).length > 0 ? { envs: runtimeEnv } : {}),
    });
    const stdout = result.stdout.trim() === "" ? "(empty)" : result.stdout;
    const stderr = result.stderr.trim() === "" ? "(empty)" : result.stderr;
    const sandboxLabel = sandboxTarget.label ?? sandboxTarget.sandboxId;

    if (parsed.json) {
      return {
        message: JSON.stringify(
          {
            sandboxId: sandboxTarget.sandboxId,
            sandboxLabel,
            command: parsed.command,
            cwd,
            stdout: result.stdout,
            stderr: result.stderr,
            exitCode: result.exitCode,
          },
          null,
          2,
        ),
        exitCode: result.exitCode,
      };
    }

    return {
      message: [
        `Ran command in sandbox ${sandboxLabel}.`,
        `cwd: ${cwd}`,
        "",
        "stdout:",
        stdout,
        "",
        "stderr:",
        stderr,
      ].join("\n"),
      exitCode: result.exitCode,
    };
  });
}
