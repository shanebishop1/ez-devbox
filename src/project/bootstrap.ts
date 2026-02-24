import { createInterface } from "node:readline/promises";
import { isAbsolute, join, resolve as resolvePath } from "node:path";
import type { ResolvedLauncherConfig, ResolvedProjectRepoConfig } from "../config/schema.js";
import type { SandboxHandle } from "../e2b/lifecycle.js";
import { provisionRepos, type GitAdapter, type ProvisionedRepoSummary, type RepoExecutor } from "../repo/manager.js";
import {
  runSetupPipeline,
  type RunSetupPipelineOptions,
  type SetupCommandExecutor,
  type SetupPipelineResult,
  type SetupRunnerEvent
} from "../setup/runner.js";

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
    options: { timeoutMs: number; onProgress?: (message: string) => void }
  ) => Promise<ProvisionedRepoSummary[]>;
  runSetupForRepos: (
    handle: SandboxHandle,
    repos: ResolvedProjectRepoConfig[],
    provisionedRepos: ProvisionedRepoSummary[],
    options: RunSetupPipelineOptions
  ) => Promise<SetupPipelineResult>;
}

export interface BootstrapProjectWorkspaceOptions {
  isConnect?: boolean;
  isInteractiveTerminal?: () => boolean;
  promptInput?: (question: string) => Promise<string>;
  onProgress?: (message: string) => void;
  deps?: Partial<BootstrapProjectWorkspaceDeps>;
}

const defaultDeps: BootstrapProjectWorkspaceDeps = {
  ensureProjectDirectory: ensureProjectDirectory,
  provisionSelectedRepos: provisionSelectedRepos,
  runSetupForRepos: runSetupForRepos
};

export async function bootstrapProjectWorkspace(
  handle: SandboxHandle,
  config: ResolvedLauncherConfig,
  options: BootstrapProjectWorkspaceOptions = {}
): Promise<BootstrapProjectWorkspaceResult> {
  const deps: BootstrapProjectWorkspaceDeps = {
    ...defaultDeps,
    ...(options.deps ?? {})
  };

  const timeoutMs = config.sandbox.timeout_ms;
  await deps.ensureProjectDirectory(handle, config.project.dir, { timeoutMs });

  const selectedRepos = await selectRepos(config.project.repos, config.project.mode, config.project.active, {
    isInteractiveTerminal: options.isInteractiveTerminal,
    promptInput: options.promptInput
  });
  options.onProgress?.(
    selectedRepos.length === 0
      ? "Bootstrap repos: none selected"
      : `Bootstrap repos selected: ${selectedRepos.map((repo) => repo.name).join(", ")}`
  );

  const provisionedRepos = await deps.provisionSelectedRepos(handle, config.project.dir, selectedRepos, {
    timeoutMs,
    onProgress: options.onProgress
  });
  const selectedRepoNames = selectedRepos.map((repo) => repo.name);
  const setup = await maybeRunSetup(handle, selectedRepos, provisionedRepos, config, options.isConnect ?? false, deps, options.onProgress);

  return {
    selectedRepoNames,
    workingDirectory: resolveWorkingDirectory(config.project.dir, config.project.working_dir, provisionedRepos),
    startupEnv: resolveStartupEnv(selectedRepos),
    provisionedRepos,
    setup
  };
}

async function maybeRunSetup(
  handle: SandboxHandle,
  selectedRepos: ResolvedProjectRepoConfig[],
  provisionedRepos: ProvisionedRepoSummary[],
  config: ResolvedLauncherConfig,
  isConnect: boolean,
  deps: BootstrapProjectWorkspaceDeps,
  onProgress?: (message: string) => void
): Promise<SetupPipelineResult | null> {
  if (selectedRepos.length === 0) {
    return null;
  }

  const reposForSetup =
    !isConnect || config.project.setup_on_connect
      ? selectedRepos
      : selectedRepos.filter((repo) => provisionedRepos.some((summary) => summary.repo === repo.name && summary.cloned));

  if (reposForSetup.length === 0) {
    return null;
  }

  return deps.runSetupForRepos(handle, reposForSetup, provisionedRepos, {
    retryPolicy: {
      attempts: config.project.setup_retries + 1
    },
    continueOnError: config.project.setup_continue_on_error,
    timeoutMs: config.sandbox.timeout_ms,
    onEvent: (event) => {
      const message = formatSetupProgressEvent(event);
      if (message) {
        onProgress?.(message);
      }
    }
  });
}

async function selectRepos(
  repos: ResolvedProjectRepoConfig[],
  mode: ResolvedLauncherConfig["project"]["mode"],
  active: ResolvedLauncherConfig["project"]["active"],
  options: Pick<BootstrapProjectWorkspaceOptions, "isInteractiveTerminal" | "promptInput">
): Promise<ResolvedProjectRepoConfig[]> {
  if (repos.length === 0) {
    return [];
  }

  if (mode === "all") {
    return [...repos];
  }

  if (repos.length === 1) {
    return [repos[0]];
  }

  if (active !== "prompt") {
    return [repos[0]];
  }

  const isInteractiveTerminal = options.isInteractiveTerminal ?? (() => Boolean(process.stdin.isTTY && process.stdout.isTTY));
  if (!isInteractiveTerminal()) {
    return [repos[0]];
  }

  const prompt = options.promptInput ?? promptInput;
  const question = [
    "Multiple repos available. Select one:",
    ...repos.map((repo, index) => `${index + 1}) ${repo.name}`),
    `Enter choice [1-${repos.length}]: `
  ].join("\n");
  const selectedIndex = Number.parseInt((await prompt(question)).trim(), 10);
  const selected = Number.isNaN(selectedIndex) ? undefined : repos[selectedIndex - 1];
  if (!selected) {
    throw new Error(`Invalid repo selection. Enter a number between 1 and ${repos.length}.`);
  }

  return [selected];
}

async function promptInput(question: string): Promise<string> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    return await readline.question(question);
  } finally {
    readline.close();
  }
}

function resolveWorkingDirectory(
  projectDir: string,
  workingDirConfig: string,
  provisionedRepos: ProvisionedRepoSummary[]
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
    ...selectedRepos[0].startup_env
  };
}

async function ensureProjectDirectory(handle: SandboxHandle, projectDir: string, options: { timeoutMs: number }): Promise<void> {
  const result = await runCommand(handle, `mkdir -p ${quoteShellArg(projectDir)}`, {
    timeoutMs: options.timeoutMs,
    commandLabel: `ensure project directory '${projectDir}'`
  });
  if (result.exitCode !== 0) {
    throw new Error(`Failed to create project directory '${projectDir}': ${result.stderr || "unknown error"}`);
  }
}

async function provisionSelectedRepos(
  handle: SandboxHandle,
  projectDir: string,
  repos: ResolvedProjectRepoConfig[],
  options: { timeoutMs: number; onProgress?: (message: string) => void }
): Promise<ProvisionedRepoSummary[]> {
  const git: GitAdapter = {
    async exists(path) {
      options.onProgress?.(`Repo check: ${path}`);
      return runBoolCheck(handle, `if [ -e ${quoteShellArg(path)} ]; then printf EZBOX_TRUE; else printf EZBOX_FALSE; fi`, {
        timeoutMs: options.timeoutMs,
        commandLabel: `check path exists '${path}'`
      });
    },
    async isGitRepo(path) {
      options.onProgress?.(`Repo validate git: ${path}`);
      return runBoolCheck(
        handle,
        `if [ -d ${quoteShellArg(join(path, ".git"))} ]; then printf EZBOX_TRUE; else printf EZBOX_FALSE; fi`,
        {
          timeoutMs: options.timeoutMs,
          commandLabel: `check git repo '${path}'`
        }
      );
    }
  };

  const executor: RepoExecutor = {
    async clone(url, targetPath) {
      options.onProgress?.(`Repo clone: ${targetPath}`);
      await runRequiredCommand(handle, `git clone ${quoteShellArg(url)} ${quoteShellArg(targetPath)}`, {
        timeoutMs: options.timeoutMs,
        commandLabel: `clone repo '${targetPath}'`
      });
    },
    async getCurrentBranch(repoPath) {
      options.onProgress?.(`Repo branch detect: ${repoPath}`);
      const result = await runRequiredCommand(handle, `git -C ${quoteShellArg(repoPath)} rev-parse --abbrev-ref HEAD`, {
        timeoutMs: options.timeoutMs,
        commandLabel: `detect branch '${repoPath}'`
      });
      return result.stdout.trim();
    },
    async checkoutBranch(repoPath, branch) {
      options.onProgress?.(`Repo branch switch: ${repoPath} -> ${branch}`);
      await runRequiredCommand(handle, `git -C ${quoteShellArg(repoPath)} checkout ${quoteShellArg(branch)}`, {
        timeoutMs: options.timeoutMs,
        commandLabel: `checkout branch '${branch}' in '${repoPath}'`
      });
    }
  };

  const summaries = await provisionRepos({
    projectDir,
    repos,
    git,
    executor
  });

  for (const summary of summaries) {
    options.onProgress?.(`Repo provisioned: ${summary.repo} reused=${summary.reused} cloned=${summary.cloned} branchSwitched=${summary.branchSwitched}`);
  }

  return summaries;
}

async function runSetupForRepos(
  handle: SandboxHandle,
  repos: ResolvedProjectRepoConfig[],
  provisionedRepos: ProvisionedRepoSummary[],
  options: RunSetupPipelineOptions
): Promise<SetupPipelineResult> {
  const pathByName = new Map(provisionedRepos.map((repo) => [repo.repo, repo.path]));
  const executor: SetupCommandExecutor = {
    async run(command, runOptions) {
      const result = await runCommand(handle, command, {
        cwd: runOptions.cwd,
        envs: runOptions.env,
        timeoutMs: runOptions.timeoutMs,
        commandLabel: `setup command '${command}'`
      });

      emitLines(result.stdout, runOptions.onStdoutLine);
      emitLines(result.stderr, runOptions.onStderrLine);

      return {
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr
      };
    }
  };

  const setupRepos = repos.map((repo) => {
    const path = pathByName.get(repo.name);
    if (!path) {
      throw new Error(`Missing provisioned path for repo '${repo.name}'.`);
    }

    return {
      name: repo.name,
      path,
      setup_command: repo.setup_command,
      setup_env: repo.setup_env
    };
  });

  return runSetupPipeline(setupRepos, executor, options);
}

async function runBoolCheck(
  handle: SandboxHandle,
  command: string,
  options: { timeoutMs: number; commandLabel: string }
): Promise<boolean> {
  const result = await runCommand(handle, command, {
    timeoutMs: options.timeoutMs,
    commandLabel: options.commandLabel
  });
  if (result.exitCode !== 0) {
    throw new Error(`Command failed: ${command}: ${result.stderr || "unknown error"}`);
  }

  const marker = result.stdout.trim();
  if (marker === "EZBOX_TRUE") {
    return true;
  }
  if (marker === "EZBOX_FALSE") {
    return false;
  }

  throw new Error(`Command failed: ${command}: unexpected boolean marker '${marker || "empty"}'`);
}

async function runRequiredCommand(
  handle: SandboxHandle,
  command: string,
  options: { timeoutMs: number; commandLabel: string }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const result = await runCommand(handle, command, {
    timeoutMs: options.timeoutMs,
    commandLabel: options.commandLabel
  });
  if (result.exitCode !== 0) {
    throw new Error(`Command failed: ${command}: ${result.stderr || "unknown error"}`);
  }
  return result;
}

async function runCommand(
  handle: SandboxHandle,
  command: string,
  options: { timeoutMs?: number; cwd?: string; envs?: Record<string, string>; commandLabel: string }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    return await handle.run(command, {
      timeoutMs: options.timeoutMs,
      cwd: options.cwd,
      envs: options.envs
    });
  } catch (error) {
    throw new Error(`Bootstrap command failed (${options.commandLabel}): ${toErrorMessage(error)}`);
  }
}

function formatSetupProgressEvent(event: SetupRunnerEvent): string | null {
  switch (event.type) {
    case "step:start":
      return `Setup start: repo=${event.repo} step=${event.step} attempt=${event.attempt}`;
    case "step:retry":
      return `Setup retry: repo=${event.repo} step=${event.step} attempt=${event.attempt} next=${event.nextAttempt} error=${event.error}`;
    case "step:success":
      return `Setup success: repo=${event.repo} step=${event.step} attempts=${event.attempts}`;
    case "step:failure":
      return `Setup failure: repo=${event.repo} step=${event.step} attempts=${event.attempts} error=${event.error}`;
    default:
      return null;
  }
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }
  return "unknown error";
}

function emitLines(output: string, onLine?: (line: string) => void): void {
  if (!onLine || output.trim() === "") {
    return;
  }

  for (const line of output.split(/\r?\n/)) {
    if (line === "") {
      continue;
    }
    onLine(line);
  }
}

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `"'\"'\"'`)}'`;
}
