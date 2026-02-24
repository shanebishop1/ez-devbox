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

function isSetupCommand(command: string, setupCommand: string): boolean {
  return command === setupCommand || command.endsWith(` ${setupCommand}`);
}

function createConfig(overrides?: Partial<ResolvedLauncherConfig["project"]>): ResolvedLauncherConfig {
  return {
    sandbox: {
      template: "opencode",
      reuse: true,
      name: "ez-devbox",
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
    gh: {
      enabled: false,
      config_dir: ""
    },
    tunnel: {
      ports: []
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

  it("reuses preferred active repo without prompting", async () => {
    const repos = [createRepo("alpha"), createRepo("beta")];
    const config = createConfig({ mode: "single", active: "prompt", repos });
    const handle = createHandle();

    const promptInput = vi.fn().mockResolvedValue("1");
    const provisionSelectedRepos = vi.fn().mockResolvedValue([
      { repo: "beta", path: "/workspace/beta", cloned: true, reused: false, branchSwitched: false }
    ]);

    const result = await bootstrapProjectWorkspace(handle, config, {
      isInteractiveTerminal: () => true,
      promptInput,
      preferredActiveRepo: "beta",
      deps: {
        ensureProjectDirectory: vi.fn().mockResolvedValue(undefined),
        provisionSelectedRepos,
        runSetupForRepos: vi.fn().mockResolvedValue({ success: true, repos: [] })
      }
    });

    expect(result.selectedRepoNames).toEqual(["beta"]);
    expect(promptInput).not.toHaveBeenCalled();
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
      if (isSetupCommand(command, "npm ci")) {
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

  it("uses GH_TOKEN variable in github clone URL when runtime token exists", async () => {
    const repo: ResolvedProjectRepoConfig = {
      ...createRepo("alpha"),
      url: "https://github.com/acme/private.git"
    };
    const config = createConfig({ repos: [repo] });
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
      if (isSetupCommand(command, "npm ci")) {
        return { stdout: "done\n", stderr: "", exitCode: 0 };
      }

      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const handle = {
      ...createHandle(),
      run
    };

    await bootstrapProjectWorkspace(handle, config, {
      runtimeEnv: {
        GH_TOKEN: "gh-secret",
        GITHUB_TOKEN: "github-secret"
      }
    });

    expect(run).toHaveBeenCalledWith(
      "git clone \"https://x-access-token:$GH_TOKEN@github.com/acme/private.git\" '/workspace/alpha'",
      expect.objectContaining({
        timeoutMs: 1000,
        envs: {
          GH_TOKEN: "gh-secret",
          GITHUB_TOKEN: "github-secret"
        }
      })
    );
  });

  it("keeps plain github clone URL when runtime token is missing", async () => {
    const repo: ResolvedProjectRepoConfig = {
      ...createRepo("alpha"),
      url: "https://github.com/acme/private.git"
    };
    const config = createConfig({ repos: [repo] });
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
      if (isSetupCommand(command, "npm ci")) {
        return { stdout: "done\n", stderr: "", exitCode: 0 };
      }

      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const handle = {
      ...createHandle(),
      run
    };

    await bootstrapProjectWorkspace(handle, config, {
      runtimeEnv: {
        NODE_ENV: "test"
      }
    });

    expect(run).toHaveBeenCalledWith(
      "git clone 'https://github.com/acme/private.git' '/workspace/alpha'",
      expect.objectContaining({
        timeoutMs: 1000,
        envs: {
          NODE_ENV: "test"
        }
      })
    );
  });

  it("redacts sensitive output in bootstrap command errors", async () => {
    const repo: ResolvedProjectRepoConfig = {
      ...createRepo("alpha"),
      url: "https://github.com/acme/private.git"
    };
    const config = createConfig({ repos: [repo] });
    const run = vi.fn().mockImplementation(async (command: string) => {
      if (command.startsWith("mkdir -p")) {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (command.includes("if [ -e '/workspace/alpha' ]")) {
        return { stdout: "EZBOX_FALSE", stderr: "", exitCode: 0 };
      }
      if (command.startsWith("git clone ")) {
        return {
          stdout: "",
          stderr:
            "fatal: auth failed GH_TOKEN=ghp_secret https://x-access-token:ghp_secret@github.com/acme/private.git Authorization: Bearer abc123",
          exitCode: 1
        };
      }

      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const handle = {
      ...createHandle(),
      run
    };

    await expect(bootstrapProjectWorkspace(handle, config)).rejects.toThrow(
      /GH_TOKEN=\[REDACTED\].*x-access-token:\[REDACTED\]@github\.com.*Bearer \[REDACTED\]/
    );
  });

  it("injects sandbox PATH into setup env when runtime env omits PATH", async () => {
    const config = createConfig({ repos: [createRepo("alpha")] });
    const run = vi.fn().mockImplementation(async (command: string) => {
      if (command === 'printf %s "$PATH"') {
        return { stdout: "/usr/local/bin:/usr/bin:/bin", stderr: "", exitCode: 0 };
      }
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
      if (isSetupCommand(command, "npm ci")) {
        return { stdout: "done\n", stderr: "", exitCode: 0 };
      }

      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const handle = {
      ...createHandle(),
      run
    };

    await bootstrapProjectWorkspace(handle, config);

    expect(run).toHaveBeenCalledWith('printf %s "$PATH"', expect.objectContaining({ timeoutMs: 1000 }));
    expect(run).toHaveBeenCalledWith(
      expect.stringContaining("npm ci"),
      expect.objectContaining({
        timeoutMs: 1000,
        cwd: "/workspace/alpha",
        envs: {
          PATH: "/usr/local/bin:/usr/bin:/bin",
          GIT_AUTHOR_NAME: "E2B Launcher",
          GIT_AUTHOR_EMAIL: "launcher@example.local",
          GIT_COMMITTER_NAME: "E2B Launcher",
          GIT_COMMITTER_EMAIL: "launcher@example.local"
        }
      })
    );
  });

  it("keeps caller PATH and skips sandbox PATH lookup when PATH is provided", async () => {
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
      if (isSetupCommand(command, "npm ci")) {
        return { stdout: "done\n", stderr: "", exitCode: 0 };
      }

      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const handle = {
      ...createHandle(),
      run
    };

    await bootstrapProjectWorkspace(handle, config, {
      runtimeEnv: {
        PATH: "/custom/bin",
        NODE_ENV: "test"
      }
    });

    expect(run).not.toHaveBeenCalledWith('printf %s "$PATH"', expect.anything());
    expect(run).toHaveBeenCalledWith(
      expect.stringContaining("npm ci"),
      expect.objectContaining({
        timeoutMs: 1000,
        cwd: "/workspace/alpha",
        envs: {
          PATH: "/custom/bin",
          NODE_ENV: "test",
          GIT_AUTHOR_NAME: "E2B Launcher",
          GIT_AUTHOR_EMAIL: "launcher@example.local",
          GIT_COMMITTER_NAME: "E2B Launcher",
          GIT_COMMITTER_EMAIL: "launcher@example.local"
        }
      })
    );
  });

  it("keeps explicit git identity values from runtime env", async () => {
    const config = createConfig({ repos: [createRepo("alpha")] });
    const run = vi.fn().mockImplementation(async (command: string) => {
      if (command === 'printf %s "$PATH"') {
        return { stdout: "/usr/local/bin:/usr/bin:/bin", stderr: "", exitCode: 0 };
      }
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
      if (isSetupCommand(command, "npm ci")) {
        return { stdout: "done\n", stderr: "", exitCode: 0 };
      }

      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const handle = {
      ...createHandle(),
      run
    };

    await bootstrapProjectWorkspace(handle, config, {
      runtimeEnv: {
        GIT_AUTHOR_NAME: "Repo Bot",
        GIT_AUTHOR_EMAIL: "repo-bot@example.com"
      }
    });

    expect(run).toHaveBeenCalledWith(
      expect.stringContaining("npm ci"),
      expect.objectContaining({
        timeoutMs: 1000,
        cwd: "/workspace/alpha",
        envs: {
          PATH: expect.any(String),
          GIT_AUTHOR_NAME: "Repo Bot",
          GIT_AUTHOR_EMAIL: "repo-bot@example.com",
          GIT_COMMITTER_NAME: "Repo Bot",
          GIT_COMMITTER_EMAIL: "repo-bot@example.com"
        }
      })
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

  it("falls back to origin tracking checkout when local branch checkout fails", async () => {
    const repo: ResolvedProjectRepoConfig = {
      ...createRepo("alpha"),
      branch: "dev",
      setup_command: ""
    };
    const config = createConfig({ repos: [repo] });

    const run = vi.fn().mockImplementation(async (command: string) => {
      if (command.startsWith("mkdir -p")) {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (command.includes("if [ -e '/workspace/alpha' ]")) {
        return { stdout: "EZBOX_TRUE", stderr: "", exitCode: 0 };
      }
      if (command.includes("if [ -d '/workspace/alpha/.git' ]")) {
        return { stdout: "EZBOX_TRUE", stderr: "", exitCode: 0 };
      }
      if (command.includes("rev-parse --abbrev-ref HEAD")) {
        return { stdout: "main\n", stderr: "", exitCode: 0 };
      }
      if (command === "git -C '/workspace/alpha' checkout 'dev'") {
        return { stdout: "", stderr: "pathspec 'dev' did not match", exitCode: 1 };
      }
      if (command === "git -C '/workspace/alpha' fetch origin 'dev'") {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (command === "git -C '/workspace/alpha' checkout -B 'dev' --track 'origin/dev'") {
        return { stdout: "Switched to a new branch", stderr: "", exitCode: 0 };
      }

      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const handle = {
      ...createHandle(),
      run
    };

    await bootstrapProjectWorkspace(handle, config);

    expect(run).toHaveBeenCalledWith("git -C '/workspace/alpha' checkout 'dev'", expect.objectContaining({ timeoutMs: 1000 }));
    expect(run).toHaveBeenCalledWith("git -C '/workspace/alpha' fetch origin 'dev'", expect.objectContaining({ timeoutMs: 1000 }));
    expect(run).toHaveBeenCalledWith(
      "git -C '/workspace/alpha' checkout -B 'dev' --track 'origin/dev'",
      expect.objectContaining({ timeoutMs: 1000 })
    );
  });

  it("throws actionable checkout error with repo path and branch when fallback fails", async () => {
    const repo: ResolvedProjectRepoConfig = {
      ...createRepo("alpha"),
      branch: "dev",
      setup_command: ""
    };
    const config = createConfig({ repos: [repo] });

    const run = vi.fn().mockImplementation(async (command: string) => {
      if (command.startsWith("mkdir -p")) {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (command.includes("if [ -e '/workspace/alpha' ]")) {
        return { stdout: "EZBOX_TRUE", stderr: "", exitCode: 0 };
      }
      if (command.includes("if [ -d '/workspace/alpha/.git' ]")) {
        return { stdout: "EZBOX_TRUE", stderr: "", exitCode: 0 };
      }
      if (command.includes("rev-parse --abbrev-ref HEAD")) {
        return { stdout: "main\n", stderr: "", exitCode: 0 };
      }
      if (command === "git -C '/workspace/alpha' checkout 'dev'") {
        return { stdout: "", stderr: "pathspec 'dev' did not match", exitCode: 1 };
      }
      if (command === "git -C '/workspace/alpha' fetch origin 'dev'") {
        return { stdout: "", stderr: "remote branch not found", exitCode: 1 };
      }

      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const handle = {
      ...createHandle(),
      run
    };

    await expect(bootstrapProjectWorkspace(handle, config)).rejects.toThrow(
      "Failed to checkout branch 'dev' in repo '/workspace/alpha'. Try updating project.repos[].branch."
    );
  });
});
