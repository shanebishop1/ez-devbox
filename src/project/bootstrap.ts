import { isAbsolute, resolve as resolvePath } from "node:path";
import type { ResolvedLauncherConfig, ResolvedProjectRepoConfig } from "../config/schema.js";
import type { SandboxHandle } from "../e2b/lifecycle.js";
import type { ProvisionedRepoSummary } from "../repo/manager.js";
import type { RunSetupPipelineOptions, SetupPipelineResult } from "../setup/runner.js";
import { resolveSetupRuntimeEnv } from "./bootstrap.git.js";
import { ensureProjectDirectory, provisionSelectedRepos, runSetupForRepos } from "./bootstrap.repo-ops.js";
import { selectRepos } from "./bootstrap.repo-selection.js";
import { maybeRunSetup } from "./bootstrap.setup.js";

export interface BootstrapProjectWorkspaceResult {
  selectedRepoNames: string[];
  workingDirectory: string | undefined;
  startupEnv: Record<string, string>;
  provisionedRepos: ProvisionedRepoSummary[];
  setup: SetupPipelineResult | null;
}

export interface BootstrapProjectWorkspaceDeps {
  ensureProjectDirectory: (handle: SandboxHandle, projectDir: string, options: { timeoutMs: number }) => Promise<void>;
  provisionSelectedRepos: (
    handle: SandboxHandle,
    projectDir: string,
    repos: ResolvedProjectRepoConfig[],
    options: { timeoutMs: number; runtimeEnv?: Record<string, string>; onProgress?: (message: string) => void },
  ) => Promise<ProvisionedRepoSummary[]>;
  runSetupForRepos: (
    handle: SandboxHandle,
    repos: ResolvedProjectRepoConfig[],
    provisionedRepos: ProvisionedRepoSummary[],
    options: RunSetupPipelineOptions & { runtimeEnv?: Record<string, string> },
  ) => Promise<SetupPipelineResult>;
}

export interface BootstrapProjectWorkspaceOptions {
  isConnect?: boolean;
  isInteractiveTerminal?: () => boolean;
  promptInput?: (question: string) => Promise<string>;
  preferredActiveRepo?: string;
  runtimeEnv?: Record<string, string>;
  onProgress?: (message: string) => void;
  deps?: Partial<BootstrapProjectWorkspaceDeps>;
}

const defaultDeps: BootstrapProjectWorkspaceDeps = {
  ensureProjectDirectory,
  provisionSelectedRepos,
  runSetupForRepos,
};

export async function bootstrapProjectWorkspace(
  handle: SandboxHandle,
  config: ResolvedLauncherConfig,
  options: BootstrapProjectWorkspaceOptions = {},
): Promise<BootstrapProjectWorkspaceResult> {
  const deps: BootstrapProjectWorkspaceDeps = {
    ...defaultDeps,
    ...(options.deps ?? {}),
  };

  const timeoutMs = config.sandbox.timeout_ms;
  const runtimeEnv = options.runtimeEnv ?? {};
  const setupRuntimeEnv = await resolveSetupRuntimeEnv(handle, runtimeEnv, timeoutMs);
  await deps.ensureProjectDirectory(handle, config.project.dir, { timeoutMs });

  const selectedRepos = await selectRepos(config.project.repos, config.project.mode, config.project.active, {
    isInteractiveTerminal: options.isInteractiveTerminal,
    promptInput: options.promptInput,
    preferredActiveRepo: options.preferredActiveRepo,
    activeName: config.project.active_name,
    activeIndex: config.project.active_index,
  });
  options.onProgress?.(
    selectedRepos.length === 0
      ? "Bootstrap repos: none selected"
      : `Bootstrap repos selected: ${selectedRepos.map((repo) => repo.name).join(", ")}`,
  );

  const provisionedRepos = await deps.provisionSelectedRepos(handle, config.project.dir, selectedRepos, {
    timeoutMs,
    runtimeEnv,
    onProgress: options.onProgress,
  });
  const selectedRepoNames = selectedRepos.map((repo) => repo.name);
  const setup = await maybeRunSetup(
    handle,
    selectedRepos,
    provisionedRepos,
    config,
    options.isConnect ?? false,
    deps,
    setupRuntimeEnv,
    options.onProgress,
  );

  return {
    selectedRepoNames,
    workingDirectory: resolveWorkingDirectory(config.project.dir, config.project.working_dir, provisionedRepos),
    startupEnv: resolveStartupEnv(selectedRepos),
    provisionedRepos,
    setup,
  };
}

function resolveWorkingDirectory(
  projectDir: string,
  workingDirConfig: string,
  provisionedRepos: ProvisionedRepoSummary[],
): string | undefined {
  if (workingDirConfig === "auto") {
    if (provisionedRepos.length === 0) {
      return undefined;
    }

    if (provisionedRepos.length === 1) {
      return provisionedRepos[0].path;
    }

    return projectDir;
  }

  return isAbsolute(workingDirConfig) ? workingDirConfig : resolvePath(projectDir, workingDirConfig);
}

function resolveStartupEnv(selectedRepos: ResolvedProjectRepoConfig[]): Record<string, string> {
  if (selectedRepos.length !== 1) {
    return {};
  }

  return {
    ...selectedRepos[0].startup_env,
  };
}
