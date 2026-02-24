import { describe, expect, it, vi } from "vitest";
import type { ResolvedLauncherConfig, ResolvedProjectRepoConfig } from "../src/config/schema.js";
import type { SandboxHandle } from "../src/e2b/lifecycle.js";
import { bootstrapProjectWorkspace } from "../src/project/bootstrap.js";

function createRepo(name: string): ResolvedProjectRepoConfig {
  return {
    name,
    url: `https://example.com/${name}.git`,
    branch: "main",
    setup_pre_command: "",
    setup_command: "npm ci",
    setup_wrapper_command: "",
    setup_env: {},
    startup_env: {
      REPO_NAME: name
    }
  };
}

function createConfig(overrides?: Partial<ResolvedLauncherConfig["project"]>): ResolvedLauncherConfig {
  return {
    sandbox: {
      template: "opencode",
      reuse: true,
      name: "ez-box",
      timeout_ms: 1000,
      delete_on_exit: false
    },
    startup: {
      mode: "prompt"
    },
    project: {
      mode: "single",
      active: "prompt",
      dir: "/workspace",
      setup_on_connect: false,
      setup_retries: 2,
      setup_continue_on_error: false,
      repos: [],
      ...(overrides ?? {})
    },
    env: {
      pass_through: []
    },
    opencode: {
      config_dir: "",
      auth_path: ""
    },
    codex: {
      config_dir: "",
      auth_path: ""
    },
    mcp: {
      mode: "disabled",
      firecrawl_api_url: "",
      allow_localhost_override: false
    }
  };
}

function createHandle(): SandboxHandle {
  return {
    sandboxId: "sbx-1",
    run: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    writeFile: vi.fn().mockResolvedValue(undefined),
    getHost: vi.fn().mockResolvedValue(""),
    setTimeout: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined)
  };
}

describe("project bootstrap", () => {
  it("selects all mode and returns parent cwd", async () => {
    const repos = [createRepo("alpha"), createRepo("beta")];
    const config = createConfig({ mode: "all", repos });
    const handle = createHandle();

    const ensureProjectDirectory = vi.fn().mockResolvedValue(undefined);
    const provisionSelectedRepos = vi.fn().mockResolvedValue([
      { repo: "alpha", path: "/workspace/alpha", cloned: false, reused: true, branchSwitched: false },
      { repo: "beta", path: "/workspace/beta", cloned: false, reused: true, branchSwitched: false }
    ]);
    const runSetupForRepos = vi.fn().mockResolvedValue({ success: true, repos: [] });

    const result = await bootstrapProjectWorkspace(handle, config, {
      deps: {
        ensureProjectDirectory,
        provisionSelectedRepos,
        runSetupForRepos
      }
    });

    expect(result.selectedRepoNames).toEqual(["alpha", "beta"]);
    expect(result.workingDirectory).toBe("/workspace");
    expect(result.startupEnv).toEqual({});
    expect(provisionSelectedRepos).toHaveBeenCalledWith(handle, "/workspace", repos);
  });

  it("supports single prompt selection", async () => {
    const repos = [createRepo("alpha"), createRepo("beta")];
    const config = createConfig({ mode: "single", active: "prompt", repos });
    const handle = createHandle();

    const provisionSelectedRepos = vi.fn().mockResolvedValue([
      { repo: "beta", path: "/workspace/beta", cloned: true, reused: false, branchSwitched: false }
    ]);

    const result = await bootstrapProjectWorkspace(handle, config, {
      isInteractiveTerminal: () => true,
      promptInput: vi.fn().mockResolvedValue("2"),
      deps: {
        ensureProjectDirectory: vi.fn().mockResolvedValue(undefined),
        provisionSelectedRepos,
        runSetupForRepos: vi.fn().mockResolvedValue({ success: true, repos: [] })
      }
    });

    expect(result.selectedRepoNames).toEqual(["beta"]);
    expect(result.workingDirectory).toBe("/workspace/beta");
    expect(result.startupEnv).toEqual({ REPO_NAME: "beta" });
    expect(provisionSelectedRepos).toHaveBeenCalledWith(handle, "/workspace", [repos[1]]);
  });

  it("falls back to first repo for non-interactive prompt", async () => {
    const repos = [createRepo("alpha"), createRepo("beta")];
    const config = createConfig({ mode: "single", active: "prompt", repos });
    const handle = createHandle();

    const promptInput = vi.fn().mockResolvedValue("2");
    const provisionSelectedRepos = vi.fn().mockResolvedValue([
      { repo: "alpha", path: "/workspace/alpha", cloned: true, reused: false, branchSwitched: false }
    ]);

    const result = await bootstrapProjectWorkspace(handle, config, {
      isInteractiveTerminal: () => false,
      promptInput,
      deps: {
        ensureProjectDirectory: vi.fn().mockResolvedValue(undefined),
        provisionSelectedRepos,
        runSetupForRepos: vi.fn().mockResolvedValue({ success: true, repos: [] })
      }
    });

    expect(result.selectedRepoNames).toEqual(["alpha"]);
    expect(promptInput).not.toHaveBeenCalled();
  });

  it("skips setup on connect when repo reused and setup_on_connect is false", async () => {
    const repos = [createRepo("alpha")];
    const config = createConfig({ mode: "single", active: "prompt", repos, setup_on_connect: false });
    const handle = createHandle();

    const runSetupForRepos = vi.fn().mockResolvedValue({ success: true, repos: [] });

    const result = await bootstrapProjectWorkspace(handle, config, {
      isConnect: true,
      deps: {
        ensureProjectDirectory: vi.fn().mockResolvedValue(undefined),
        provisionSelectedRepos: vi.fn().mockResolvedValue([
          { repo: "alpha", path: "/workspace/alpha", cloned: false, reused: true, branchSwitched: false }
        ]),
        runSetupForRepos
      }
    });

    expect(runSetupForRepos).not.toHaveBeenCalled();
    expect(result.setup).toBeNull();
  });

  it("runs setup on connect when cloned or setup_on_connect is true", async () => {
    const repos = [createRepo("alpha")];
    const handle = createHandle();

    const runSetupForReposA = vi.fn().mockResolvedValue({ success: true, repos: [] });
    await bootstrapProjectWorkspace(handle, createConfig({ repos, setup_on_connect: false }), {
      isConnect: true,
      deps: {
        ensureProjectDirectory: vi.fn().mockResolvedValue(undefined),
        provisionSelectedRepos: vi.fn().mockResolvedValue([
          { repo: "alpha", path: "/workspace/alpha", cloned: true, reused: false, branchSwitched: false }
        ]),
        runSetupForRepos: runSetupForReposA
      }
    });

    const runSetupForReposB = vi.fn().mockResolvedValue({ success: true, repos: [] });
    await bootstrapProjectWorkspace(handle, createConfig({ repos, setup_on_connect: true }), {
      isConnect: true,
      deps: {
        ensureProjectDirectory: vi.fn().mockResolvedValue(undefined),
        provisionSelectedRepos: vi.fn().mockResolvedValue([
          { repo: "alpha", path: "/workspace/alpha", cloned: false, reused: true, branchSwitched: false }
        ]),
        runSetupForRepos: runSetupForReposB
      }
    });

    expect(runSetupForReposA).toHaveBeenCalledTimes(1);
    expect(runSetupForReposB).toHaveBeenCalledTimes(1);
  });
});
