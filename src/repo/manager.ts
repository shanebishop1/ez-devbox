import { join } from "node:path";

export interface RepoSpec {
  name: string;
  url: string;
  branch?: string;
}

export interface GitAdapter {
  exists(path: string): Promise<boolean>;
  isGitRepo(path: string): Promise<boolean>;
}

export interface RepoExecutor {
  clone(url: string, targetPath: string): Promise<void>;
  getCurrentBranch(repoPath: string): Promise<string>;
  checkoutBranch(repoPath: string, branch: string): Promise<void>;
}

export interface ProvisionReposInput {
  projectDir: string;
  repos: RepoSpec[];
  git: GitAdapter;
  executor: RepoExecutor;
}

export interface ProvisionedRepoSummary {
  repo: string;
  path: string;
  cloned: boolean;
  reused: boolean;
  branchSwitched: boolean;
}

export async function provisionRepos(input: ProvisionReposInput): Promise<ProvisionedRepoSummary[]> {
  const summaries: ProvisionedRepoSummary[] = [];

  for (const repo of input.repos) {
    const path = join(input.projectDir, repo.name);
    const exists = await input.git.exists(path);

    let cloned = false;
    let reused = false;

    if (!exists) {
      await input.executor.clone(repo.url, path);
      cloned = true;
    } else {
      const gitRepo = await input.git.isGitRepo(path);
      if (!gitRepo) {
        throw new Error(`Cannot provision repo '${repo.name}' at '${path}': directory exists but is not a git repository.`);
      }
      reused = true;
    }

    let branchSwitched = false;
    const desiredBranch = repo.branch?.trim();
    if (desiredBranch) {
      const currentBranch = await input.executor.getCurrentBranch(path);
      if (currentBranch !== desiredBranch) {
        await input.executor.checkoutBranch(path, desiredBranch);
        branchSwitched = true;
      }
    }

    summaries.push({
      repo: repo.name,
      path,
      cloned,
      reused,
      branchSwitched
    });
  }

  return summaries;
}
