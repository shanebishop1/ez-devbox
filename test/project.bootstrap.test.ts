import { describe, expect, it, vi } from "vitest";
import type { ResolvedLauncherConfig, ResolvedProjectRepoConfig } from "../src/config/schema.js";
import type { SandboxHandle } from "../src/e2b/lifecycle.js";
import { bootstrapProjectWorkspace } from "../src/project/bootstrap.js";

function createRepo(name: string): ResolvedProjectRepoConfig {
  return {
    name,
    url: `https://example.com/${name}.git`,
    branch: "main",
    setup_command: "npm ci",
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
      working_dir: "auto",
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
    expect(provisionSelectedRepos).toHaveBeenCalledWith(handle, "/workspace", repos, expect.objectContaining({ timeoutMs: 1000 }));
  });

  it("keeps auto working_dir behavior for none/single/multiple repos", async () => {
    const handle = createHandle();
    const ensureProjectDirectory = vi.fn().mockResolvedValue(undefined);
    const runSetupForRepos = vi.fn().mockResolvedValue({ success: true, repos: [] });

    const noneResult = await bootstrapProjectWorkspace(handle, createConfig({ repos: [], working_dir: "auto" }), {
      deps: {
        ensureProjectDirectory,
        provisionSelectedRepos: vi.fn().mockResolvedValue([]),
        runSetupForRepos
      }
    });

    const singleResult = await bootstrapProjectWorkspace(handle, createConfig({ repos: [createRepo("alpha")], working_dir: "auto" }), {
      deps: {
        ensureProjectDirectory,
        provisionSelectedRepos: vi.fn().mockResolvedValue([
          { repo: "alpha", path: "/workspace/alpha", cloned: false, reused: true, branchSwitched: false }
        ]),
        runSetupForRepos
      }
    });

    const multiResult = await bootstrapProjectWorkspace(
      handle,
      createConfig({ mode: "all", repos: [createRepo("alpha"), createRepo("beta")], working_dir: "auto" }),
      {
        deps: {
          ensureProjectDirectory,
          provisionSelectedRepos: vi.fn().mockResolvedValue([
            { repo: "alpha", path: "/workspace/alpha", cloned: false, reused: true, branchSwitched: false },
            { repo: "beta", path: "/workspace/beta", cloned: false, reused: true, branchSwitched: false }
          ]),
          runSetupForRepos
        }
      }
    );

    expect(noneResult.workingDirectory).toBeUndefined();
    expect(singleResult.workingDirectory).toBe("/workspace/alpha");
    expect(multiResult.workingDirectory).toBe("/workspace");
  });

  it("uses absolute project.working_dir as launch cwd", async () => {
    const config = createConfig({ working_dir: "/opt/custom-cwd", repos: [createRepo("alpha")] });
    const handle = createHandle();

    const result = await bootstrapProjectWorkspace(handle, config, {
      deps: {
        ensureProjectDirectory: vi.fn().mockResolvedValue(undefined),
        provisionSelectedRepos: vi.fn().mockResolvedValue([
          { repo: "alpha", path: "/workspace/alpha", cloned: false, reused: true, branchSwitched: false }
        ]),
        runSetupForRepos: vi.fn().mockResolvedValue({ success: true, repos: [] })
      }
    });

    expect(result.workingDirectory).toBe("/opt/custom-cwd");
  });

  it("resolves relative project.working_dir under project.dir", async () => {
    const config = createConfig({ working_dir: "./custom-cwd", repos: [createRepo("alpha")] });
    const handle = createHandle();

    const result = await bootstrapProjectWorkspace(handle, config, {
      deps: {
        ensureProjectDirectory: vi.fn().mockResolvedValue(undefined),
        provisionSelectedRepos: vi.fn().mockResolvedValue([
          { repo: "alpha", path: "/workspace/alpha", cloned: false, reused: true, branchSwitched: false }
        ]),
        runSetupForRepos: vi.fn().mockResolvedValue({ success: true, repos: [] })
      }
    });

    expect(result.workingDirectory).toBe("/workspace/custom-cwd");
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
    expect(provisionSelectedRepos).toHaveBeenCalledWith(
      handle,
      "/workspace",
      [repos[1]],
      expect.objectContaining({ timeoutMs: 1000 })
    );
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

  it("uses deterministic stdout markers for boolean repo existence checks", async () => {
    const config = createConfig({ repos: [createRepo("alpha")] });
    const run = vi.fn().mockImplementation(async (command: string) => {
      if (command.startsWith("mkdir -p")) {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (command.includes("if [ -e '/workspace/alpha' ]")) {
        return { stdout: "EZBOX_FALSE", stderr: "", exitCode: 0 };
      }
      if (command.startsWith("git clone ")) {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (command.includes("rev-parse --abbrev-ref HEAD")) {
        return { stdout: "main\n", stderr: "", exitCode: 0 };
      }
      if (command === "npm ci") {
        return { stdout: "done\n", stderr: "", exitCode: 0 };
      }

      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const handle = {
      ...createHandle(),
      run
    };

    const result = await bootstrapProjectWorkspace(handle, config);

    expect(result.selectedRepoNames).toEqual(["alpha"]);
    expect(run).toHaveBeenCalledWith(
      "if [ -e '/workspace/alpha' ]; then printf EZBOX_TRUE; else printf EZBOX_FALSE; fi",
      expect.objectContaining({ timeoutMs: 1000 })
    );
  });

  it("maps setup runner events to progress callback", async () => {
    const progress = vi.fn();
    const runSetupForRepos = vi.fn().mockImplementation(async (_handle, _repos, _provisionedRepos, options) => {
      options.onEvent?.({ type: "step:start", repo: "alpha", step: "setup_command", command: "npm ci", attempt: 1 });
      options.onEvent?.({
        type: "step:retry",
        repo: "alpha",
        step: "setup_command",
        command: "npm ci",
        attempt: 1,
        nextAttempt: 2,
        error: "deadline exceeded"
      });
      options.onEvent?.({ type: "step:success", repo: "alpha", step: "setup_command", command: "npm ci", attempts: 2 });
      return { success: true, repos: [] };
    });

    await bootstrapProjectWorkspace(createHandle(), createConfig({ repos: [createRepo("alpha")] }), {
      onProgress: progress,
      deps: {
        ensureProjectDirectory: vi.fn().mockResolvedValue(undefined),
        provisionSelectedRepos: vi.fn().mockResolvedValue([
          { repo: "alpha", path: "/workspace/alpha", cloned: true, reused: false, branchSwitched: false }
        ]),
        runSetupForRepos
      }
    });

    expect(progress).toHaveBeenCalledWith("Setup start: repo=alpha step=setup_command attempt=1");
    expect(progress).toHaveBeenCalledWith(
      "Setup retry: repo=alpha step=setup_command attempt=1 next=2 error=deadline exceeded"
    );
    expect(progress).toHaveBeenCalledWith("Setup success: repo=alpha step=setup_command attempts=2");
  });
});
