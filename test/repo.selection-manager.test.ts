import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { provisionRepos, type GitAdapter, type RepoExecutor } from "../src/repo/manager.js";
import { selectReposForProvisioning } from "../src/repo/selection.js";

describe("repo selection", () => {
  const repos = [
    { name: "alpha", url: "https://example.com/alpha.git", branch: "main" },
    { name: "beta", url: "https://example.com/beta.git", branch: "main" },
    { name: "gamma", url: "https://example.com/gamma.git", branch: "main" }
  ];

  it("selects repos for all mode and all single active styles", () => {
    expect(
      selectReposForProvisioning({
        mode: "all",
        active: "prompt",
        repos
      })
    ).toEqual(repos);

    expect(
      selectReposForProvisioning({
        mode: "single",
        active: "name",
        activeName: "beta",
        repos
      })
    ).toEqual([repos[1]]);

    expect(
      selectReposForProvisioning({
        mode: "single",
        active: "index",
        activeIndex: 0,
        repos
      })
    ).toEqual([repos[0]]);

    expect(
      selectReposForProvisioning({
        mode: "single",
        active: "prompt",
        promptIndex: 2,
        repos
      })
    ).toEqual([repos[2]]);
  });

  it("throws actionable validation errors for invalid name and index", () => {
    expect(() =>
      selectReposForProvisioning({
        mode: "single",
        active: "name",
        activeName: "missing",
        repos
      })
    ).toThrow("Invalid active repo name 'missing'");

    expect(() =>
      selectReposForProvisioning({
        mode: "single",
        active: "index",
        activeIndex: 7,
        repos
      })
    ).toThrow("out of range");
  });
});

describe("repo manager", () => {
  it("clones missing repo and reuses existing repo", async () => {
    const git: GitAdapter = {
      exists: vi.fn(async (path: string) => path.endsWith("missing")),
      isGitRepo: vi.fn(async (path: string) => path.endsWith("missing"))
    };
    const executor: RepoExecutor = {
      clone: vi.fn().mockResolvedValue(undefined),
      getCurrentBranch: vi.fn().mockResolvedValue("main"),
      checkoutBranch: vi.fn().mockResolvedValue(undefined)
    };

    const result = await provisionRepos({
      projectDir: "/workspace",
      repos: [
        { name: "new", url: "https://example.com/new.git" },
        { name: "missing", url: "https://example.com/missing.git" }
      ],
      git,
      executor
    });

    expect(executor.clone).toHaveBeenCalledTimes(1);
    expect(executor.clone).toHaveBeenCalledWith("https://example.com/new.git", join("/workspace", "new"));
    expect(result).toEqual([
      {
        repo: "new",
        path: join("/workspace", "new"),
        cloned: true,
        reused: false,
        branchSwitched: false
      },
      {
        repo: "missing",
        path: join("/workspace", "missing"),
        cloned: false,
        reused: true,
        branchSwitched: false
      }
    ]);
  });

  it("switches branch when current branch mismatches configured branch", async () => {
    const git: GitAdapter = {
      exists: vi.fn().mockResolvedValue(true),
      isGitRepo: vi.fn().mockResolvedValue(true)
    };
    const executor: RepoExecutor = {
      clone: vi.fn().mockResolvedValue(undefined),
      getCurrentBranch: vi.fn().mockResolvedValue("develop"),
      checkoutBranch: vi.fn().mockResolvedValue(undefined)
    };

    const result = await provisionRepos({
      projectDir: "/workspace",
      repos: [{ name: "app", url: "https://example.com/app.git", branch: "main" }],
      git,
      executor
    });

    expect(executor.checkoutBranch).toHaveBeenCalledWith(join("/workspace", "app"), "main");
    expect(result[0].branchSwitched).toBe(true);
  });
});
