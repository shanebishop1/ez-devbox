import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { CommandExitError } from "e2b";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ResolvedLauncherConfig, ResolvedProjectRepoConfig } from "../src/config/schema.js";
import { LauncherE2BLifecycleError, type SandboxHandle } from "../src/e2b/lifecycle.js";
import { bootstrapProjectWorkspace } from "../src/project/bootstrap.js";
import { provisionSelectedRepos } from "../src/project/bootstrap.repo-ops.js";

const execFileAsync = promisify(execFile);
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.map((path) => rm(path, { recursive: true, force: true })));
  tempRoots.length = 0;
});

function createRepo(name: string): ResolvedProjectRepoConfig {
  return {
    name,
    url: `https://example.com/${name}.git`,
    branch: "main",
    setup_command: "npm ci",
    setup_env: {},
    startup_env: {
      REPO_NAME: name,
    },
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
      delete_on_exit: false,
    },
    startup: {
      mode: "prompt",
    },
    project: {
      mode: "single",
      active: "prompt",
      dir: "/workspace",
      working_dir: "auto",
      setup_on_connect: false,
      setup_retries: 2,
      setup_concurrency: 1,
      setup_continue_on_error: false,
      repos: [],
      ...(overrides ?? {}),
    },
    env: {
      pass_through: [],
    },
    opencode: {
      config_dir: "",
      auth_path: "",
    },
    codex: {
      config_dir: "",
      auth_path: "",
    },
    claude: {
      config_dir: "",
      state_path: "",
    },
    gh: {
      enabled: false,
      config_dir: "",
    },
    tunnel: {
      ports: [],
    },
  };
}

function createHandle(): SandboxHandle {
  return {
    sandboxId: "sbx-1",
    run: vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    writeFile: vi.fn().mockResolvedValue(undefined),
    getHost: vi.fn().mockResolvedValue(""),
    setTimeout: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
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
      { repo: "beta", path: "/workspace/beta", cloned: false, reused: true, branchSwitched: false },
    ]);
    const runSetupForRepos = vi.fn().mockResolvedValue({ success: true, repos: [] });

    const result = await bootstrapProjectWorkspace(handle, config, {
      deps: {
        ensureProjectDirectory,
        provisionSelectedRepos,
        runSetupForRepos,
      },
    });

    expect(result.selectedRepoNames).toEqual(["alpha", "beta"]);
    expect(result.workingDirectory).toBe("/workspace");
    expect(result.startupEnv).toEqual({});
    expect(provisionSelectedRepos).toHaveBeenCalledWith(
      handle,
      "/workspace",
      repos,
      expect.objectContaining({ timeoutMs: 1000 }),
    );
  });

  it("keeps auto working_dir behavior for none/single/multiple repos", async () => {
    const handle = createHandle();
    const ensureProjectDirectory = vi.fn().mockResolvedValue(undefined);
    const runSetupForRepos = vi.fn().mockResolvedValue({ success: true, repos: [] });

    const noneResult = await bootstrapProjectWorkspace(handle, createConfig({ repos: [], working_dir: "auto" }), {
      deps: {
        ensureProjectDirectory,
        provisionSelectedRepos: vi.fn().mockResolvedValue([]),
        runSetupForRepos,
      },
    });

    const singleResult = await bootstrapProjectWorkspace(
      handle,
      createConfig({ repos: [createRepo("alpha")], working_dir: "auto" }),
      {
        deps: {
          ensureProjectDirectory,
          provisionSelectedRepos: vi
            .fn()
            .mockResolvedValue([
              { repo: "alpha", path: "/workspace/alpha", cloned: false, reused: true, branchSwitched: false },
            ]),
          runSetupForRepos,
        },
      },
    );

    const multiResult = await bootstrapProjectWorkspace(
      handle,
      createConfig({ mode: "all", repos: [createRepo("alpha"), createRepo("beta")], working_dir: "auto" }),
      {
        deps: {
          ensureProjectDirectory,
          provisionSelectedRepos: vi.fn().mockResolvedValue([
            { repo: "alpha", path: "/workspace/alpha", cloned: false, reused: true, branchSwitched: false },
            { repo: "beta", path: "/workspace/beta", cloned: false, reused: true, branchSwitched: false },
          ]),
          runSetupForRepos,
        },
      },
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
        provisionSelectedRepos: vi
          .fn()
          .mockResolvedValue([
            { repo: "alpha", path: "/workspace/alpha", cloned: false, reused: true, branchSwitched: false },
          ]),
        runSetupForRepos: vi.fn().mockResolvedValue({ success: true, repos: [] }),
      },
    });

    expect(result.workingDirectory).toBe("/opt/custom-cwd");
  });

  it("resolves relative project.working_dir under project.dir", async () => {
    const config = createConfig({ working_dir: "./custom-cwd", repos: [createRepo("alpha")] });
    const handle = createHandle();

    const result = await bootstrapProjectWorkspace(handle, config, {
      deps: {
        ensureProjectDirectory: vi.fn().mockResolvedValue(undefined),
        provisionSelectedRepos: vi
          .fn()
          .mockResolvedValue([
            { repo: "alpha", path: "/workspace/alpha", cloned: false, reused: true, branchSwitched: false },
          ]),
        runSetupForRepos: vi.fn().mockResolvedValue({ success: true, repos: [] }),
      },
    });

    expect(result.workingDirectory).toBe("/workspace/custom-cwd");
  });

  it("supports single prompt selection", async () => {
    const repos = [createRepo("alpha"), createRepo("beta")];
    const config = createConfig({ mode: "single", active: "prompt", repos });
    const handle = createHandle();

    const provisionSelectedRepos = vi
      .fn()
      .mockResolvedValue([
        { repo: "beta", path: "/workspace/beta", cloned: true, reused: false, branchSwitched: false },
      ]);

    const result = await bootstrapProjectWorkspace(handle, config, {
      isInteractiveTerminal: () => true,
      promptInput: vi.fn().mockResolvedValue("2"),
      deps: {
        ensureProjectDirectory: vi.fn().mockResolvedValue(undefined),
        provisionSelectedRepos,
        runSetupForRepos: vi.fn().mockResolvedValue({ success: true, repos: [] }),
      },
    });

    expect(result.selectedRepoNames).toEqual(["beta"]);
    expect(result.workingDirectory).toBe("/workspace/beta");
    expect(result.startupEnv).toEqual({ REPO_NAME: "beta" });
    expect(provisionSelectedRepos).toHaveBeenCalledWith(
      handle,
      "/workspace",
      [repos[1]],
      expect.objectContaining({ timeoutMs: 1000 }),
    );
  });

  it("reuses preferred active repo without prompting", async () => {
    const repos = [createRepo("alpha"), createRepo("beta")];
    const config = createConfig({ mode: "single", active: "prompt", repos });
    const handle = createHandle();

    const promptInput = vi.fn().mockResolvedValue("1");
    const provisionSelectedRepos = vi
      .fn()
      .mockResolvedValue([
        { repo: "beta", path: "/workspace/beta", cloned: true, reused: false, branchSwitched: false },
      ]);

    const result = await bootstrapProjectWorkspace(handle, config, {
      isInteractiveTerminal: () => true,
      promptInput,
      preferredActiveRepo: "beta",
      deps: {
        ensureProjectDirectory: vi.fn().mockResolvedValue(undefined),
        provisionSelectedRepos,
        runSetupForRepos: vi.fn().mockResolvedValue({ success: true, repos: [] }),
      },
    });

    expect(result.selectedRepoNames).toEqual(["beta"]);
    expect(promptInput).not.toHaveBeenCalled();
    expect(provisionSelectedRepos).toHaveBeenCalledWith(
      handle,
      "/workspace",
      [repos[1]],
      expect.objectContaining({ timeoutMs: 1000 }),
    );
  });

  it("falls back to first repo for non-interactive prompt", async () => {
    const repos = [createRepo("alpha"), createRepo("beta")];
    const config = createConfig({ mode: "single", active: "prompt", repos });
    const handle = createHandle();

    const promptInput = vi.fn().mockResolvedValue("2");
    const provisionSelectedRepos = vi
      .fn()
      .mockResolvedValue([
        { repo: "alpha", path: "/workspace/alpha", cloned: true, reused: false, branchSwitched: false },
      ]);

    const result = await bootstrapProjectWorkspace(handle, config, {
      isInteractiveTerminal: () => false,
      promptInput,
      deps: {
        ensureProjectDirectory: vi.fn().mockResolvedValue(undefined),
        provisionSelectedRepos,
        runSetupForRepos: vi.fn().mockResolvedValue({ success: true, repos: [] }),
      },
    });

    expect(result.selectedRepoNames).toEqual(["alpha"]);
    expect(promptInput).not.toHaveBeenCalled();
  });

  it("selects configured repo by project.active=name without prompting", async () => {
    const repos = [createRepo("alpha"), createRepo("beta")];
    const config = createConfig({ mode: "single", active: "name", active_name: "beta", repos });
    const handle = createHandle();
    const promptInput = vi.fn().mockResolvedValue("1");
    const provisionSelectedRepos = vi
      .fn()
      .mockResolvedValue([
        { repo: "beta", path: "/workspace/beta", cloned: true, reused: false, branchSwitched: false },
      ]);

    const result = await bootstrapProjectWorkspace(handle, config, {
      isInteractiveTerminal: () => true,
      promptInput,
      deps: {
        ensureProjectDirectory: vi.fn().mockResolvedValue(undefined),
        provisionSelectedRepos,
        runSetupForRepos: vi.fn().mockResolvedValue({ success: true, repos: [] }),
      },
    });

    expect(result.selectedRepoNames).toEqual(["beta"]);
    expect(promptInput).not.toHaveBeenCalled();
  });

  it("selects configured repo by project.active=index in non-interactive mode", async () => {
    const repos = [createRepo("alpha"), createRepo("beta"), createRepo("gamma")];
    const config = createConfig({ mode: "single", active: "index", active_index: 2, repos });
    const handle = createHandle();
    const promptInput = vi.fn().mockResolvedValue("1");
    const provisionSelectedRepos = vi
      .fn()
      .mockResolvedValue([
        { repo: "gamma", path: "/workspace/gamma", cloned: true, reused: false, branchSwitched: false },
      ]);

    const result = await bootstrapProjectWorkspace(handle, config, {
      isInteractiveTerminal: () => false,
      promptInput,
      deps: {
        ensureProjectDirectory: vi.fn().mockResolvedValue(undefined),
        provisionSelectedRepos,
        runSetupForRepos: vi.fn().mockResolvedValue({ success: true, repos: [] }),
      },
    });

    expect(result.selectedRepoNames).toEqual(["gamma"]);
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
        provisionSelectedRepos: vi
          .fn()
          .mockResolvedValue([
            { repo: "alpha", path: "/workspace/alpha", cloned: false, reused: true, branchSwitched: false },
          ]),
        runSetupForRepos,
      },
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
        provisionSelectedRepos: vi
          .fn()
          .mockResolvedValue([
            { repo: "alpha", path: "/workspace/alpha", cloned: true, reused: false, branchSwitched: false },
          ]),
        runSetupForRepos: runSetupForReposA,
      },
    });

    const runSetupForReposB = vi.fn().mockResolvedValue({ success: true, repos: [] });
    await bootstrapProjectWorkspace(handle, createConfig({ repos, setup_on_connect: true }), {
      isConnect: true,
      deps: {
        ensureProjectDirectory: vi.fn().mockResolvedValue(undefined),
        provisionSelectedRepos: vi
          .fn()
          .mockResolvedValue([
            { repo: "alpha", path: "/workspace/alpha", cloned: false, reused: true, branchSwitched: false },
          ]),
        runSetupForRepos: runSetupForReposB,
      },
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
      run,
    };

    const result = await bootstrapProjectWorkspace(handle, config);

    expect(result.selectedRepoNames).toEqual(["alpha"]);
    expect(run).toHaveBeenCalledWith(
      "if [ -e '/workspace/alpha' ]; then printf EZBOX_TRUE; else printf EZBOX_FALSE; fi",
      expect.objectContaining({ timeoutMs: 1000 }),
    );
  });

  it("uses GH_TOKEN variable in github clone URL when runtime token exists", async () => {
    const repo: ResolvedProjectRepoConfig = {
      ...createRepo("alpha"),
      url: "https://github.com/acme/private.git",
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
      run,
    };

    await bootstrapProjectWorkspace(handle, config, {
      runtimeEnv: {
        GH_TOKEN: "gh-secret",
        GITHUB_TOKEN: "github-secret",
      },
    });

    expect(run).toHaveBeenCalledWith(
      "git clone \"https://x-access-token:$GH_TOKEN@github.com/acme/private.git\" '/workspace/alpha'",
      expect.objectContaining({
        timeoutMs: 1000,
        envs: {
          GH_TOKEN: "gh-secret",
          GITHUB_TOKEN: "github-secret",
        },
      }),
    );
  });

  it("keeps plain github clone URL when runtime token is missing", async () => {
    const repo: ResolvedProjectRepoConfig = {
      ...createRepo("alpha"),
      url: "https://github.com/acme/private.git",
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
      run,
    };

    await bootstrapProjectWorkspace(handle, config, {
      runtimeEnv: {
        NODE_ENV: "test",
      },
    });

    expect(run).toHaveBeenCalledWith(
      "git clone 'https://github.com/acme/private.git' '/workspace/alpha'",
      expect.objectContaining({
        timeoutMs: 1000,
        envs: {
          NODE_ENV: "test",
        },
      }),
    );
  });

  it("redacts sensitive output in bootstrap command errors", async () => {
    const repo: ResolvedProjectRepoConfig = {
      ...createRepo("alpha"),
      url: "https://github.com/acme/private.git",
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
          exitCode: 1,
        };
      }

      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const handle = {
      ...createHandle(),
      run,
    };

    await expect(bootstrapProjectWorkspace(handle, config)).rejects.toThrow(
      /GH_TOKEN=\[REDACTED\].*x-access-token:\[REDACTED\]@github\.com.*Bearer \[REDACTED\]/,
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
      run,
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
          GIT_COMMITTER_EMAIL: "launcher@example.local",
        },
      }),
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
      run,
    };

    await bootstrapProjectWorkspace(handle, config, {
      runtimeEnv: {
        PATH: "/custom/bin",
        NODE_ENV: "test",
      },
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
          GIT_COMMITTER_EMAIL: "launcher@example.local",
        },
      }),
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
      run,
    };

    await bootstrapProjectWorkspace(handle, config, {
      runtimeEnv: {
        GIT_AUTHOR_NAME: "Repo Bot",
        GIT_AUTHOR_EMAIL: "repo-bot@example.com",
      },
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
          GIT_COMMITTER_EMAIL: "repo-bot@example.com",
        },
      }),
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
        error: "deadline exceeded",
      });
      options.onEvent?.({ type: "step:success", repo: "alpha", step: "setup_command", command: "npm ci", attempts: 2 });
      return { success: true, repos: [] };
    });

    await bootstrapProjectWorkspace(createHandle(), createConfig({ repos: [createRepo("alpha")] }), {
      onProgress: progress,
      deps: {
        ensureProjectDirectory: vi.fn().mockResolvedValue(undefined),
        provisionSelectedRepos: vi
          .fn()
          .mockResolvedValue([
            { repo: "alpha", path: "/workspace/alpha", cloned: true, reused: false, branchSwitched: false },
          ]),
        runSetupForRepos,
      },
    });

    expect(progress).toHaveBeenCalledWith("Setup start: repo=alpha step=setup_command attempt=1");
    expect(progress).toHaveBeenCalledWith(
      "Setup retry: repo=alpha step=setup_command attempt=1 next=2 error=deadline exceeded",
    );
    expect(progress).toHaveBeenCalledWith("Setup success: repo=alpha step=setup_command attempts=2");
  });

  it("passes setup_concurrency to setup runner options", async () => {
    const runSetupForRepos = vi.fn().mockResolvedValue({ success: true, repos: [] });

    await bootstrapProjectWorkspace(
      createHandle(),
      createConfig({ repos: [createRepo("alpha")], setup_concurrency: 3 }),
      {
        deps: {
          ensureProjectDirectory: vi.fn().mockResolvedValue(undefined),
          provisionSelectedRepos: vi
            .fn()
            .mockResolvedValue([
              { repo: "alpha", path: "/workspace/alpha", cloned: true, reused: false, branchSwitched: false },
            ]),
          runSetupForRepos,
        },
      },
    );

    expect(runSetupForRepos).toHaveBeenCalledWith(
      expect.any(Object),
      expect.any(Array),
      expect.any(Array),
      expect.objectContaining({ maxConcurrency: 3 }),
    );
  });

  it("creates an origin tracking checkout when the local branch is absent", async () => {
    const repo: ResolvedProjectRepoConfig = {
      ...createRepo("alpha"),
      branch: "dev",
      setup_command: "",
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
      if (command === "git -C '/workspace/alpha' remote get-url origin") {
        return { stdout: "https://example.com/alpha.git\n", stderr: "", exitCode: 0 };
      }
      if (command.includes("rev-parse --abbrev-ref HEAD")) {
        return { stdout: "main\n", stderr: "", exitCode: 0 };
      }
      if (command === "git -C '/workspace/alpha' show-ref --verify --quiet 'refs/heads/dev'") {
        return { stdout: "", stderr: "", exitCode: 1 };
      }
      if (command === "git -C '/workspace/alpha' fetch origin 'refs/heads/dev:refs/remotes/origin/dev'") {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (command === "git -C '/workspace/alpha' switch --track -- 'refs/remotes/origin/dev'") {
        return { stdout: "Switched to a new branch", stderr: "", exitCode: 0 };
      }

      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const handle = {
      ...createHandle(),
      run,
    };

    await bootstrapProjectWorkspace(handle, config);

    expect(run).toHaveBeenCalledWith(
      "git -C '/workspace/alpha' show-ref --verify --quiet 'refs/heads/dev'",
      expect.objectContaining({ timeoutMs: 1000 }),
    );
    expect(run).toHaveBeenCalledWith(
      "git -C '/workspace/alpha' fetch origin 'refs/heads/dev:refs/remotes/origin/dev'",
      expect.objectContaining({ timeoutMs: 1000 }),
    );
    expect(run).toHaveBeenCalledWith(
      "git -C '/workspace/alpha' switch --track -- 'refs/remotes/origin/dev'",
      expect.objectContaining({ timeoutMs: 1000 }),
    );
  });

  it("throws actionable checkout error with repo path and branch when fallback fails", async () => {
    const repo: ResolvedProjectRepoConfig = {
      ...createRepo("alpha"),
      branch: "dev",
      setup_command: "",
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
      if (command === "git -C '/workspace/alpha' remote get-url origin") {
        return { stdout: "https://example.com/alpha.git\n", stderr: "", exitCode: 0 };
      }
      if (command.includes("rev-parse --abbrev-ref HEAD")) {
        return { stdout: "main\n", stderr: "", exitCode: 0 };
      }
      if (command === "git -C '/workspace/alpha' show-ref --verify --quiet 'refs/heads/dev'") {
        return { stdout: "", stderr: "", exitCode: 1 };
      }
      if (command === "git -C '/workspace/alpha' fetch origin 'refs/heads/dev:refs/remotes/origin/dev'") {
        return { stdout: "", stderr: "remote branch not found", exitCode: 1 };
      }

      return { stdout: "", stderr: "", exitCode: 0 };
    });

    const handle = {
      ...createHandle(),
      run,
    };

    await expect(bootstrapProjectWorkspace(handle, config)).rejects.toThrow(
      "Failed to checkout branch 'dev' in repo '/workspace/alpha'. Try updating project.repos[].branch.",
    );
  });

  it("redacts credential-bearing fetch output from lifecycle-wrapped command failures", async () => {
    const repo = { ...createRepo("alpha"), branch: "dev", setup_command: "" };
    const config = createConfig({ repos: [repo] });
    const fetchFailure = new LauncherE2BLifecycleError(
      "fetch failed",
      new CommandExitError({
        stdout: "",
        stderr: "fatal: unable to access https://x-access-token:ghp_secret@github.com/acme/alpha.git/",
        exitCode: 1,
      }),
    );
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
      if (command === "git -C '/workspace/alpha' remote get-url origin") {
        return { stdout: "https://example.com/alpha.git\n", stderr: "", exitCode: 0 };
      }
      if (command.includes("rev-parse --abbrev-ref HEAD")) {
        return { stdout: "main\n", stderr: "", exitCode: 0 };
      }
      if (command === "git -C '/workspace/alpha' show-ref --verify --quiet 'refs/heads/dev'") {
        return { stdout: "", stderr: "", exitCode: 1 };
      }
      if (command === "git -C '/workspace/alpha' fetch origin 'refs/heads/dev:refs/remotes/origin/dev'") {
        throw fetchFailure;
      }

      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const handle = { ...createHandle(), run };

    const error = await bootstrapProjectWorkspace(handle, config).catch((caught: unknown) => caught as Error);
    if (!(error instanceof Error)) {
      throw new Error("Expected bootstrap to reject when fetch fails.");
    }

    expect(error.message).toContain("x-access-token:[REDACTED]@github.com");
    expect(error.message).not.toContain("ghp_secret");
  });

  it("uses completed SDK command failures for branch detection and preserves transport failures", async () => {
    const repo = { ...createRepo("alpha"), branch: "dev", setup_command: "" };
    const config = createConfig({ repos: [repo] });
    const completedFailure = new LauncherE2BLifecycleError(
      "Failed to run command",
      new CommandExitError({ stdout: "", stderr: "missing local branch", exitCode: 1 }),
    );
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
      if (command === "git -C '/workspace/alpha' remote get-url origin") {
        return { stdout: "https://example.com/alpha.git\n", stderr: "", exitCode: 0 };
      }
      if (command.includes("rev-parse --abbrev-ref HEAD")) {
        return { stdout: "main\n", stderr: "", exitCode: 0 };
      }
      if (command === "git -C '/workspace/alpha' show-ref --verify --quiet 'refs/heads/dev'") {
        throw completedFailure;
      }
      if (command === "git -C '/workspace/alpha' fetch origin 'refs/heads/dev:refs/remotes/origin/dev'") {
        throw new LauncherE2BLifecycleError("transport failed", new Error("connection reset"));
      }

      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const handle = { ...createHandle(), run };

    await expect(bootstrapProjectWorkspace(handle, config)).rejects.toThrow(/transport failed/);
    expect(run).not.toHaveBeenCalledWith(
      "git -C '/workspace/alpha' switch --track -- 'refs/remotes/origin/dev'",
      expect.anything(),
    );
  });

  it("does not fetch or replace an existing local branch when checkout fails", async () => {
    const repo = { ...createRepo("alpha"), branch: "dev", setup_command: "" };
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
      if (command === "git -C '/workspace/alpha' remote get-url origin") {
        return { stdout: "https://example.com/alpha.git\n", stderr: "", exitCode: 0 };
      }
      if (command.includes("rev-parse --abbrev-ref HEAD")) {
        return { stdout: "main\n", stderr: "", exitCode: 0 };
      }
      if (command === "git -C '/workspace/alpha' show-ref --verify --quiet 'refs/heads/dev'") {
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      if (command === "git -C '/workspace/alpha' switch --no-guess -- 'dev'") {
        throw new LauncherE2BLifecycleError(
          "checkout failed",
          new CommandExitError({ stdout: "", stderr: "would overwrite local changes", exitCode: 1 }),
        );
      }

      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const handle = { ...createHandle(), run };

    await expect(bootstrapProjectWorkspace(handle, config)).rejects.toThrow(/would overwrite local changes/);
    expect(run).not.toHaveBeenCalledWith(expect.stringContaining(" fetch origin "), expect.anything());
    expect(run).not.toHaveBeenCalledWith(expect.stringContaining("switch --track"), expect.anything());
  });

  it("checks out an existing local branch without fetching using real Git", async () => {
    const fixture = await createGitFixture();
    await git(fixture.repoPath, "branch", "existing");
    const commands: string[] = [];
    const handle = createLocalGitHandle(commands);

    const summaries = await provisionSelectedRepos(
      handle,
      fixture.workspacePath,
      [{ ...createRepo("alpha"), url: fixture.remotePath, branch: "existing", setup_command: "" }],
      { timeoutMs: 5_000 },
    );

    expect(summaries[0]).toMatchObject({ branchSwitched: true, reused: true, cloned: false });
    await expect(git(fixture.repoPath, "branch", "--show-current")).resolves.toMatchObject({ stdout: "existing\n" });
    expect(commands).toContain(`git -C '${fixture.repoPath}' switch --no-guess -- 'existing'`);
    expect(commands.some((command) => command.includes(" fetch origin "))).toBe(false);
  });

  it("preserves a dirty worktree and both branch commits when existing checkout fails", async () => {
    const fixture = await createGitFixture();
    await git(fixture.repoPath, "switch", "-c", "existing");
    await writeFile(join(fixture.repoPath, "README.md"), "existing branch\n");
    await git(fixture.repoPath, "add", "README.md");
    await git(fixture.repoPath, "commit", "-m", "existing branch");
    await git(fixture.repoPath, "switch", "main");
    await writeFile(join(fixture.repoPath, "README.md"), "dirty worktree\n");
    const currentHead = (await git(fixture.repoPath, "rev-parse", "HEAD")).stdout;
    const existingHead = (await git(fixture.repoPath, "rev-parse", "refs/heads/existing")).stdout;
    const commands: string[] = [];

    await expect(
      provisionSelectedRepos(
        createLocalGitHandle(commands),
        fixture.workspacePath,
        [{ ...createRepo("alpha"), url: fixture.remotePath, branch: "existing", setup_command: "" }],
        { timeoutMs: 5_000 },
      ),
    ).rejects.toThrow(/would be overwritten by checkout/);

    await expect(git(fixture.repoPath, "branch", "--show-current")).resolves.toMatchObject({ stdout: "main\n" });
    await expect(git(fixture.repoPath, "rev-parse", "HEAD")).resolves.toMatchObject({ stdout: currentHead });
    await expect(git(fixture.repoPath, "rev-parse", "refs/heads/existing")).resolves.toMatchObject({
      stdout: existingHead,
    });
    await expect(readFile(join(fixture.repoPath, "README.md"), "utf8")).resolves.toBe("dirty worktree\n");
    expect(commands.some((command) => command.includes(" fetch origin "))).toBe(false);
  });

  it("fetches and tracks a new remote branch using exact refs with real Git", async () => {
    const fixture = await createGitFixture();
    const commands: string[] = [];
    const handle = createLocalGitHandle(commands);

    await expect(git(fixture.repoPath, "show-ref", "--verify", "--quiet", "refs/remotes/origin/dev")).rejects.toThrow();

    const summaries = await provisionSelectedRepos(
      handle,
      fixture.workspacePath,
      [{ ...createRepo("alpha"), url: fixture.remotePath, branch: "dev", setup_command: "" }],
      { timeoutMs: 5_000 },
    );

    expect(summaries[0]).toMatchObject({ branchSwitched: true, reused: true, cloned: false });
    await expect(git(fixture.repoPath, "branch", "--show-current")).resolves.toMatchObject({ stdout: "dev\n" });
    await expect(
      git(fixture.repoPath, "for-each-ref", "--format=%(upstream:short)", "refs/heads/dev"),
    ).resolves.toMatchObject({ stdout: "origin/dev\n" });
    expect(commands).toContain(`git -C '${fixture.repoPath}' fetch origin 'refs/heads/dev:refs/remotes/origin/dev'`);
    expect(commands).toContain(`git -C '${fixture.repoPath}' switch --track -- 'refs/remotes/origin/dev'`);
  });
});

interface GitFixture {
  remotePath: string;
  repoPath: string;
  workspacePath: string;
}

async function createGitFixture(): Promise<GitFixture> {
  const root = await mkdtemp(join(tmpdir(), "ez-devbox-bootstrap-git-"));
  tempRoots.push(root);
  const remotePath = join(root, "remote.git");
  const seedPath = join(root, "seed");
  const repoPath = join(root, "workspace", "alpha");
  await mkdir(join(root, "workspace"));
  await git(root, "init", "--bare", remotePath);
  await git(root, "init", "-b", "main", seedPath);
  await writeFile(join(seedPath, "README.md"), "main\n");
  await git(seedPath, "add", "README.md");
  await git(seedPath, "commit", "-m", "initial");
  await git(seedPath, "remote", "add", "origin", remotePath);
  await git(seedPath, "push", "-u", "origin", "main");
  await git(join(root, "workspace"), "clone", "--branch", "main", remotePath, repoPath);
  await git(seedPath, "switch", "-c", "dev");
  await writeFile(join(seedPath, "DEV.md"), "dev\n");
  await git(seedPath, "add", "DEV.md");
  await git(seedPath, "commit", "-m", "dev");
  await git(seedPath, "push", "-u", "origin", "dev");
  return { remotePath, repoPath, workspacePath: join(root, "workspace") };
}

async function git(cwd: string, ...args: string[]): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync("git", args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_EMAIL: "ez-devbox-test@example.com",
      GIT_AUTHOR_NAME: "EZ Devbox Test",
      GIT_COMMITTER_EMAIL: "ez-devbox-test@example.com",
      GIT_COMMITTER_NAME: "EZ Devbox Test",
    },
  });
  return { stdout: result.stdout.toString(), stderr: result.stderr.toString() };
}

function createLocalGitHandle(commands: string[]): SandboxHandle {
  return {
    ...createHandle(),
    run: vi.fn(async (command, options) => {
      commands.push(command);
      try {
        const result = await execFileAsync("bash", ["-lc", command], {
          cwd: options?.cwd,
          env: { ...process.env, ...(options?.envs ?? {}) },
        });
        return { stdout: result.stdout.toString(), stderr: result.stderr.toString(), exitCode: 0 };
      } catch (error) {
        const commandError = error as { code?: number | string; stderr?: string; stdout?: string };
        const exitCode = typeof commandError.code === "number" ? commandError.code : 1;
        throw new LauncherE2BLifecycleError(
          `Failed to run command '${command}'`,
          new CommandExitError({
            stdout: commandError.stdout ?? "",
            stderr: commandError.stderr ?? "",
            exitCode,
          }),
        );
      }
    }),
  };
}
