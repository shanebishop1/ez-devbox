import { createInterface } from "node:readline/promises";
import { join } from "node:path";
import type { ResolvedLauncherConfig, ResolvedProjectRepoConfig } from "../config/schema.js";
import type { SandboxHandle } from "../e2b/lifecycle.js";
import { provisionRepos, type GitAdapter, type ProvisionedRepoSummary, type RepoExecutor } from "../repo/manager.js";
import { runSetupPipeline, type RunSetupPipelineOptions, type SetupCommandExecutor, type SetupPipelineResult } from "../setup/runner.js";

export interface BootstrapProjectWorkspaceResult {
  selectedRepoNames: string[];
  workingDirectory: string | undefined;
  startupEnv: Record<string, string>;
  provisionedRepos: ProvisionedRepoSummary[];
  setup: SetupPipelineResult | null;
}

export interface BootstrapProjectWorkspaceDeps {
  ensureProjectDirectory: (handle: SandboxHandle, projectDir: string) => Promise<void>;
  provisionSelectedRepos: (
    handle: SandboxHandle,
    projectDir: string,
    repos: ResolvedProjectRepoConfig[]
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

  await deps.ensureProjectDirectory(handle, config.project.dir);

  const selectedRepos = await selectRepos(config.project.repos, config.project.mode, config.project.active, {
    isInteractiveTerminal: options.isInteractiveTerminal,
    promptInput: options.promptInput
  });

  const provisionedRepos = await deps.provisionSelectedRepos(handle, config.project.dir, selectedRepos);
  const selectedRepoNames = selectedRepos.map((repo) => repo.name);
  const setup = await maybeRunSetup(handle, selectedRepos, provisionedRepos, config, options.isConnect ?? false, deps);

  return {
    selectedRepoNames,
    workingDirectory: resolveWorkingDirectory(config.project.dir, provisionedRepos),
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
  deps: BootstrapProjectWorkspaceDeps
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
    continueOnError: config.project.setup_continue_on_error
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

function resolveWorkingDirectory(projectDir: string, provisionedRepos: ProvisionedRepoSummary[]): string | undefined {
  if (provisionedRepos.length === 0) {
    return undefined;
  }

  if (provisionedRepos.length === 1) {
    return provisionedRepos[0].path;
  }

  return projectDir;
}

function resolveStartupEnv(selectedRepos: ResolvedProjectRepoConfig[]): Record<string, string> {
  if (selectedRepos.length !== 1) {
    return {};
  }

  return {
    ...selectedRepos[0].startup_env
  };
}

async function ensureProjectDirectory(handle: SandboxHandle, projectDir: string): Promise<void> {
  const result = await handle.run(`mkdir -p ${quoteShellArg(projectDir)}`);
  if (result.exitCode !== 0) {
    throw new Error(`Failed to create project directory '${projectDir}': ${result.stderr || "unknown error"}`);
  }
}

async function provisionSelectedRepos(
  handle: SandboxHandle,
  projectDir: string,
  repos: ResolvedProjectRepoConfig[]
): Promise<ProvisionedRepoSummary[]> {
  const git: GitAdapter = {
    async exists(path) {
      return runBoolCheck(handle, `[ -e ${quoteShellArg(path)} ]`);
    },
    async isGitRepo(path) {
      return runBoolCheck(handle, `[ -d ${quoteShellArg(join(path, ".git"))} ]`);
    }
  };

  const executor: RepoExecutor = {
    async clone(url, targetPath) {
      await runRequiredCommand(handle, `git clone ${quoteShellArg(url)} ${quoteShellArg(targetPath)}`);
    },
    async getCurrentBranch(repoPath) {
      const result = await runRequiredCommand(handle, `git -C ${quoteShellArg(repoPath)} rev-parse --abbrev-ref HEAD`);
      return result.stdout.trim();
    },
    async checkoutBranch(repoPath, branch) {
      await runRequiredCommand(handle, `git -C ${quoteShellArg(repoPath)} checkout ${quoteShellArg(branch)}`);
    }
  };

  return provisionRepos({
    projectDir,
    repos,
    git,
    executor
  });
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
      const result = await handle.run(command, {
        cwd: runOptions.cwd,
        envs: runOptions.env,
        timeoutMs: runOptions.timeoutMs
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
      setup_pre_command: repo.setup_pre_command,
      setup_command: repo.setup_command,
      setup_wrapper_command: repo.setup_wrapper_command,
      setup_env: repo.setup_env
    };
  });

  return runSetupPipeline(setupRepos, executor, options);
}

async function runBoolCheck(handle: SandboxHandle, command: string): Promise<boolean> {
  const result = await handle.run(command);
  if (result.exitCode === 0) {
    return true;
  }
  if (result.exitCode === 1) {
    return false;
  }
  throw new Error(`Command failed: ${command}: ${result.stderr || "unknown error"}`);
}

async function runRequiredCommand(
  handle: SandboxHandle,
  command: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const result = await handle.run(command);
  if (result.exitCode !== 0) {
    throw new Error(`Command failed: ${command}: ${result.stderr || "unknown error"}`);
  }
  return result;
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
