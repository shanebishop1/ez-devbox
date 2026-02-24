import { createInterface } from "node:readline/promises";
import { isAbsolute, join, resolve as resolvePath } from "node:path";
import type { ResolvedLauncherConfig, ResolvedProjectRepoConfig } from "../config/schema.js";
import type { SandboxHandle } from "../e2b/lifecycle.js";
import { normalizePromptCancelledError } from "../cli/prompt-cancelled.js";
import { resolveGitIdentity } from "../auth/gitIdentity.js";
import { provisionRepos, type GitAdapter, type ProvisionedRepoSummary, type RepoExecutor } from "../repo/manager.js";
import {
  runSetupPipeline,
  type RunSetupPipelineOptions,
  type SetupCommandExecutor,
  type SetupPipelineResult,
  type SetupRunnerEvent
} from "../setup/runner.js";
import { formatPromptChoice } from "../cli/prompt-style.js";

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
    options: { timeoutMs: number; runtimeEnv?: Record<string, string>; onProgress?: (message: string) => void }
  ) => Promise<ProvisionedRepoSummary[]>;
  runSetupForRepos: (
    handle: SandboxHandle,
    repos: ResolvedProjectRepoConfig[],
    provisionedRepos: ProvisionedRepoSummary[],
    options: RunSetupPipelineOptions & { runtimeEnv?: Record<string, string> }
  ) => Promise<SetupPipelineResult>;
}

export interface BootstrapProjectWorkspaceOptions {
  isConnect?: boolean;
  isInteractiveTerminal?: () => boolean;
  promptInput?: (question: string) => Promise<string>;
  runtimeEnv?: Record<string, string>;
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
  const runtimeEnv = options.runtimeEnv ?? {};
  const setupRuntimeEnv = await resolveSetupRuntimeEnv(handle, runtimeEnv, timeoutMs);
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
    runtimeEnv,
    onProgress: options.onProgress
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
    options.onProgress
  );

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
  runtimeEnv: Record<string, string>,
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
    runtimeEnv,
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
    ...repos.map((repo, index) => formatPromptChoice(index + 1, repo.name)),
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
  } catch (error) {
    const cancelledError = normalizePromptCancelledError(error, "Repository selection cancelled.");
    if (cancelledError) {
      throw cancelledError;
    }
    throw error;
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
    throw new Error(`Failed to create project directory '${projectDir}': ${result.stderr || result.stdout || "unknown error"}`);
  }
}

async function provisionSelectedRepos(
  handle: SandboxHandle,
  projectDir: string,
  repos: ResolvedProjectRepoConfig[],
  options: { timeoutMs: number; runtimeEnv?: Record<string, string>; onProgress?: (message: string) => void }
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
      const cloneUrlArg = resolveCloneUrlShellArg(url, options.runtimeEnv);
      await runRequiredCommand(handle, `git clone ${cloneUrlArg} ${quoteShellArg(targetPath)}`, {
        envs: options.runtimeEnv,
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
      const localCheckout = await runCommand(handle, `git -C ${quoteShellArg(repoPath)} checkout ${quoteShellArg(branch)}`, {
        timeoutMs: options.timeoutMs,
        commandLabel: `checkout branch '${branch}' in '${repoPath}'`
      });
      if (localCheckout.exitCode === 0) {
        return;
      }

      options.onProgress?.(`Repo branch switch fallback: ${repoPath} -> origin/${branch}`);
      const fetchResult = await runCommand(
        handle,
        `git -C ${quoteShellArg(repoPath)} fetch origin ${quoteShellArg(branch)}`,
        {
          timeoutMs: options.timeoutMs,
          commandLabel: `fetch branch '${branch}' from origin in '${repoPath}'`
        }
      );
      if (fetchResult.exitCode === 0) {
        const remoteCheckout = await runCommand(
          handle,
          `git -C ${quoteShellArg(repoPath)} checkout -B ${quoteShellArg(branch)} --track ${quoteShellArg(`origin/${branch}`)}`,
          {
            timeoutMs: options.timeoutMs,
            commandLabel: `checkout tracking branch '${branch}' in '${repoPath}'`
          }
        );
        if (remoteCheckout.exitCode === 0) {
          return;
        }

        throw new Error(
          `Failed to checkout branch '${branch}' in repo '${repoPath}'. ` +
            `Try updating project.repos[].branch. ` +
            `Local checkout error: ${localCheckout.stderr || localCheckout.stdout || "unknown error"}. ` +
            `Remote-tracking checkout error: ${remoteCheckout.stderr || remoteCheckout.stdout || "unknown error"}`
        );
      }

      throw new Error(
        `Failed to checkout branch '${branch}' in repo '${repoPath}'. ` +
          `Try updating project.repos[].branch. ` +
          `Local checkout error: ${localCheckout.stderr || localCheckout.stdout || "unknown error"}. ` +
          `Fetch error: ${fetchResult.stderr || fetchResult.stdout || "unknown error"}`
      );
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
  options: RunSetupPipelineOptions & { runtimeEnv?: Record<string, string> }
): Promise<SetupPipelineResult> {
  const pathByName = new Map(provisionedRepos.map((repo) => [repo.repo, repo.path]));
  const executor: SetupCommandExecutor = {
    async run(command, runOptions) {
      const result = await runCommand(handle, command, {
        cwd: runOptions.cwd,
        envs: {
          ...(options.runtimeEnv ?? {}),
          ...runOptions.env
        },
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
    throw new Error(`Command failed: ${command}: ${result.stderr || result.stdout || "unknown error"}`);
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
  options: { timeoutMs: number; commandLabel: string; envs?: Record<string, string> }
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const result = await runCommand(handle, command, {
    timeoutMs: options.timeoutMs,
    envs: options.envs,
    commandLabel: options.commandLabel
  });
  if (result.exitCode !== 0) {
    throw new Error(`Command failed: ${command}: ${result.stderr || result.stdout || "unknown error"}`);
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
    case "step:stderr":
      return `Setup stderr: repo=${event.repo} step=${event.step} line=${truncateForLog(event.line)}`;
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
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

async function resolveSetupRuntimeEnv(
  handle: SandboxHandle,
  runtimeEnv: Record<string, string>,
  timeoutMs: number
): Promise<Record<string, string>> {
  const envWithGitIdentity = await resolveGitIdentityEnv(runtimeEnv);

  if (Object.hasOwn(runtimeEnv, "PATH")) {
    return envWithGitIdentity;
  }

  const pathResult = await runCommand(handle, 'printf %s "$PATH"', {
    timeoutMs,
    commandLabel: "resolve sandbox PATH"
  });
  if (pathResult.exitCode !== 0) {
    throw new Error(`Failed to resolve sandbox PATH: ${pathResult.stderr || pathResult.stdout || "unknown error"}`);
  }

  const sandboxPath = pathResult.stdout.trim();
  if (sandboxPath === "") {
    return envWithGitIdentity;
  }

  return {
    ...envWithGitIdentity,
    PATH: sandboxPath
  };
}

async function resolveGitIdentityEnv(runtimeEnv: Record<string, string>): Promise<Record<string, string>> {
  const identity = await resolveGitIdentity(runtimeEnv);
  const authorName = normalizeOptionalValue(runtimeEnv.GIT_AUTHOR_NAME) ?? identity.name;
  const authorEmail = normalizeOptionalValue(runtimeEnv.GIT_AUTHOR_EMAIL) ?? identity.email;
  const committerName = normalizeOptionalValue(runtimeEnv.GIT_COMMITTER_NAME) ?? authorName;
  const committerEmail = normalizeOptionalValue(runtimeEnv.GIT_COMMITTER_EMAIL) ?? authorEmail;

  return {
    ...runtimeEnv,
    GIT_AUTHOR_NAME: authorName,
    GIT_AUTHOR_EMAIL: authorEmail,
    GIT_COMMITTER_NAME: committerName,
    GIT_COMMITTER_EMAIL: committerEmail
  };
}

function resolveCloneUrlShellArg(url: string, runtimeEnv?: Record<string, string>): string {
  const tokenVar = resolveGithubTokenVar(runtimeEnv);
  if (!tokenVar || !isGithubHttpsUrl(url)) {
    return quoteShellArg(url);
  }

  const urlWithoutProtocol = url.slice("https://".length);
  return quoteShellDoubleArg(`https://x-access-token:$${tokenVar}@${urlWithoutProtocol}`);
}

function resolveGithubTokenVar(runtimeEnv?: Record<string, string>): "GH_TOKEN" | "GITHUB_TOKEN" | null {
  if (runtimeEnv?.GH_TOKEN) {
    return "GH_TOKEN";
  }
  if (runtimeEnv?.GITHUB_TOKEN) {
    return "GITHUB_TOKEN";
  }
  return null;
}

function isGithubHttpsUrl(url: string): boolean {
  return /^https:\/\/github\.com\//.test(url);
}

function quoteShellDoubleArg(value: string): string {
  return `"${value.replace(/["\\`]/g, "\\$&")}"`;
}

function truncateForLog(value: string, maxLength = 240): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

function normalizeOptionalValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
