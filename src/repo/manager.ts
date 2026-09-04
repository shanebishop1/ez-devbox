import { posix } from "node:path";
import { redactSensitiveText } from "../security/redaction.js";

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
  getOriginUrl(repoPath: string): Promise<string>;
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
    const path = posix.join(input.projectDir, repo.name);
    const exists = await input.git.exists(path);

    let cloned = false;
    let reused = false;

    if (!exists) {
      await input.executor.clone(repo.url, path);
      cloned = true;
    } else {
      const gitRepo = await input.git.isGitRepo(path);
      if (!gitRepo) {
        throw new Error(
          `Cannot provision repo '${repo.name}' at '${path}': directory exists but is not a git repository.`,
        );
      }
      const originUrl = (await input.executor.getOriginUrl(path)).trim();
      if (normalizeRepoUrl(originUrl) !== normalizeRepoUrl(repo.url)) {
        throw new Error(
          redactSensitiveText(
            `Cannot reuse repo '${repo.name}' at '${path}': origin URL '${originUrl || "(missing)"}' does not match configured URL '${repo.url}'.`,
          ),
        );
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
      branchSwitched,
    });
  }

  return summaries;
}

function normalizeRepoUrl(value: string): string {
  const trimmed = value.trim();
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === "http:" || parsed.protocol === "https:") {
      parsed.username = "";
      parsed.password = "";
      return parsed.href;
    }
  } catch {
    // Non-URL git remotes such as git@host:owner/repo.git are compared as-is.
  }
  return trimmed;
}
