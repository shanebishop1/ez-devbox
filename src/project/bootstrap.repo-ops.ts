import { join } from "node:path";
import type { ResolvedProjectRepoConfig } from "../config/schema.js";
import type { SandboxHandle } from "../e2b/lifecycle.js";
import {
  provisionRepos,
  type GitAdapter,
  type ProvisionedRepoSummary,
  type RepoExecutor
} from "../repo/manager.js";
import {
  runSetupPipeline,
  type RunSetupPipelineOptions,
  type SetupCommandExecutor,
  type SetupPipelineResult
} from "../setup/runner.js";
import { emitLines, quoteShellArg, runBoolCheck, runCommand, runRequiredCommand } from "./bootstrap.command-utils.js";
import { resolveCloneUrlShellArg } from "./bootstrap.git.js";

export async function ensureProjectDirectory(
  handle: SandboxHandle,
  projectDir: string,
  options: { timeoutMs: number }
): Promise<void> {
  const result = await runCommand(handle, `mkdir -p ${quoteShellArg(projectDir)}`, {
    timeoutMs: options.timeoutMs,
    commandLabel: `ensure project directory '${projectDir}'`
  });
  if (result.exitCode !== 0) {
    throw new Error(`Failed to create project directory '${projectDir}': ${result.stderr || result.stdout || "unknown error"}`);
  }
}

export async function provisionSelectedRepos(
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
      const fetchResult = await runCommand(handle, `git -C ${quoteShellArg(repoPath)} fetch origin ${quoteShellArg(branch)}`, {
        timeoutMs: options.timeoutMs,
        commandLabel: `fetch branch '${branch}' from origin in '${repoPath}'`
      });
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

export async function runSetupForRepos(
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
