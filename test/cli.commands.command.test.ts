import { describe, expect, it, vi } from "vitest";
import { runCommandCommand } from "../src/cli/commands.command.js";
import type { ResolvedLauncherConfig } from "../src/config/schema.js";
import { logger } from "../src/logging/logger.js";

const baseConfig: ResolvedLauncherConfig = {
  sandbox: {
    template: "base",
    reuse: true,
    name: "ez-devbox",
    timeout_ms: 1_800_000,
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
    setup_retries: 0,
    setup_concurrency: 1,
    setup_continue_on_error: false,
    repos: [],
  },
  env: {
    pass_through: [],
  },
  opencode: {
    config_dir: "~/.config/opencode",
    auth_path: "~/.local/share/opencode/auth.json",
  },
  codex: {
    config_dir: "~/.codex",
    auth_path: "~/.codex/auth.json",
  },
  gh: {
    enabled: false,
    config_dir: "~/.config/gh",
  },
  tunnel: {
    ports: [],
  },
};

describe("runCommandCommand", () => {
  it("rejects unexpected flags before command tokens with help guidance", async () => {
    await expect(
      runCommandCommand(["--bad", "echo", "hello"], {
        loadConfig: vi.fn().mockResolvedValue(baseConfig),
        listSandboxes: vi.fn().mockResolvedValue([]),
        connectSandbox: vi.fn(),
        loadLastRunState: vi.fn().mockResolvedValue(null),
      }),
    ).rejects.toThrow("Unknown option for command: '--bad'. Use --help for usage.");
  });

  it("validates that a remote command is provided", async () => {
    await expect(
      runCommandCommand(["--sandbox-id", "sbx-1"], {
        loadConfig: vi.fn().mockResolvedValue(baseConfig),
        listSandboxes: vi.fn().mockResolvedValue([]),
        connectSandbox: vi.fn(),
        loadLastRunState: vi.fn().mockResolvedValue(null),
      }),
    ).rejects.toThrow("Missing remote command. Provide a command after options (use -- when needed).");
  });

  it("prompts for sandbox selection when multiple exist in interactive terminals", async () => {
    const promptInput = vi.fn().mockResolvedValue("2");
    const run = vi.fn().mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });
    const connectSandbox = vi.fn().mockResolvedValue({ sandboxId: "sbx-2", run });

    const result = await runCommandCommand(["echo", "hello"], {
      loadConfig: vi.fn().mockResolvedValue(baseConfig),
      listSandboxes: vi.fn().mockResolvedValue([
        { sandboxId: "sbx-1", state: "running", metadata: { "launcher.name": "Alpha" } },
        { sandboxId: "sbx-2", state: "running", metadata: { "launcher.name": "Beta" } },
      ]),
      connectSandbox,
      loadLastRunState: vi.fn().mockResolvedValue(null),
      isInteractiveTerminal: () => true,
      promptInput,
    });

    expect(promptInput).toHaveBeenCalledWith(
      ["Multiple sandboxes available. Select one:", "1) Alpha (sbx-1)", "2) Beta (sbx-2)", "Enter choice [1-2]: "].join(
        "\n",
      ),
    );
    expect(connectSandbox).toHaveBeenCalledWith("sbx-2", baseConfig);
    expect(result.message).toContain("Ran command in sandbox Beta (sbx-2).");
  });

  it("uses last-run sandbox in non-interactive mode when still present", async () => {
    const connectSandbox = vi.fn().mockResolvedValue({
      sandboxId: "sbx-2",
      run: vi.fn().mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 }),
    });

    await runCommandCommand(["echo", "hello"], {
      loadConfig: vi.fn().mockResolvedValue(baseConfig),
      listSandboxes: vi.fn().mockResolvedValue([
        { sandboxId: "sbx-1", state: "running" },
        { sandboxId: "sbx-2", state: "running" },
      ]),
      connectSandbox,
      loadLastRunState: vi
        .fn()
        .mockResolvedValue({ sandboxId: "sbx-2", mode: "web", updatedAt: "2026-01-01T00:00:00.000Z" }),
      isInteractiveTerminal: () => false,
    });

    expect(connectSandbox).toHaveBeenCalledWith("sbx-2", baseConfig);
  });

  it("errors in non-interactive mode with multiple sandboxes and no matching last-run", async () => {
    await expect(
      runCommandCommand(["echo", "hello"], {
        loadConfig: vi.fn().mockResolvedValue(baseConfig),
        listSandboxes: vi.fn().mockResolvedValue([
          { sandboxId: "sbx-1", state: "running" },
          { sandboxId: "sbx-2", state: "running" },
        ]),
        connectSandbox: vi.fn(),
        loadLastRunState: vi
          .fn()
          .mockResolvedValue({ sandboxId: "sbx-missing", mode: "web", updatedAt: "2026-01-01T00:00:00.000Z" }),
        isInteractiveTerminal: () => false,
      }),
    ).rejects.toThrow("Re-run with --sandbox-id <sandbox-id>");
  });

  it("selects cwd for one selected repo in single mode", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });
    await runCommandCommand(["--sandbox-id", "sbx-1", "pwd"], {
      loadConfig: vi.fn().mockResolvedValue({
        ...baseConfig,
        project: {
          ...baseConfig.project,
          mode: "single",
          repos: [
            {
              name: "repo-one",
              url: "https://example.com/repo-one.git",
              branch: "main",
              setup_command: "",
              setup_env: {},
              startup_env: {},
            },
          ],
        },
      }),
      listSandboxes: vi.fn().mockResolvedValue([]),
      connectSandbox: vi.fn().mockResolvedValue({ sandboxId: "sbx-1", run }),
      loadLastRunState: vi.fn().mockResolvedValue(null),
    });

    expect(run).toHaveBeenCalledWith("pwd", { cwd: "/workspace/repo-one" });
  });

  it("selects cwd using project.active=name", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });
    await runCommandCommand(["--sandbox-id", "sbx-1", "pwd"], {
      loadConfig: vi.fn().mockResolvedValue({
        ...baseConfig,
        project: {
          ...baseConfig.project,
          mode: "single",
          active: "name",
          active_name: "repo-two",
          repos: [
            {
              name: "repo-one",
              url: "https://example.com/repo-one.git",
              branch: "main",
              setup_command: "",
              setup_env: {},
              startup_env: {},
            },
            {
              name: "repo-two",
              url: "https://example.com/repo-two.git",
              branch: "main",
              setup_command: "",
              setup_env: {},
              startup_env: {},
            },
          ],
        },
      }),
      listSandboxes: vi.fn().mockResolvedValue([]),
      connectSandbox: vi.fn().mockResolvedValue({ sandboxId: "sbx-1", run }),
      loadLastRunState: vi.fn().mockResolvedValue(null),
      isInteractiveTerminal: () => false,
    });

    expect(run).toHaveBeenCalledWith("pwd", { cwd: "/workspace/repo-two" });
  });

  it("selects cwd using project.active=index", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });
    await runCommandCommand(["--sandbox-id", "sbx-1", "pwd"], {
      loadConfig: vi.fn().mockResolvedValue({
        ...baseConfig,
        project: {
          ...baseConfig.project,
          mode: "single",
          active: "index",
          active_index: 1,
          repos: [
            {
              name: "repo-one",
              url: "https://example.com/repo-one.git",
              branch: "main",
              setup_command: "",
              setup_env: {},
              startup_env: {},
            },
            {
              name: "repo-two",
              url: "https://example.com/repo-two.git",
              branch: "main",
              setup_command: "",
              setup_env: {},
              startup_env: {},
            },
          ],
        },
      }),
      listSandboxes: vi.fn().mockResolvedValue([]),
      connectSandbox: vi.fn().mockResolvedValue({ sandboxId: "sbx-1", run }),
      loadLastRunState: vi.fn().mockResolvedValue(null),
      isInteractiveTerminal: () => true,
    });

    expect(run).toHaveBeenCalledWith("pwd", { cwd: "/workspace/repo-two" });
  });

  it("selects project dir cwd for all mode with multiple repos", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });
    await runCommandCommand(["--sandbox-id", "sbx-1", "pwd"], {
      loadConfig: vi.fn().mockResolvedValue({
        ...baseConfig,
        project: {
          ...baseConfig.project,
          mode: "all",
          repos: [
            {
              name: "repo-one",
              url: "https://example.com/repo-one.git",
              branch: "main",
              setup_command: "",
              setup_env: {},
              startup_env: {},
            },
            {
              name: "repo-two",
              url: "https://example.com/repo-two.git",
              branch: "main",
              setup_command: "",
              setup_env: {},
              startup_env: {},
            },
          ],
        },
      }),
      listSandboxes: vi.fn().mockResolvedValue([]),
      connectSandbox: vi.fn().mockResolvedValue({ sandboxId: "sbx-1", run }),
      loadLastRunState: vi.fn().mockResolvedValue(null),
    });

    expect(run).toHaveBeenCalledWith("pwd", { cwd: "/workspace" });
  });

  it("selects configured repo cwd when project.active is name", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });
    await runCommandCommand(["--sandbox-id", "sbx-1", "pwd"], {
      loadConfig: vi.fn().mockResolvedValue({
        ...baseConfig,
        project: {
          ...baseConfig.project,
          mode: "single",
          active: "name",
          active_name: "repo-two",
          repos: [
            {
              name: "repo-one",
              url: "https://example.com/repo-one.git",
              branch: "main",
              setup_command: "",
              setup_env: {},
              startup_env: {},
            },
            {
              name: "repo-two",
              url: "https://example.com/repo-two.git",
              branch: "main",
              setup_command: "",
              setup_env: {},
              startup_env: {},
            },
          ],
        },
      }),
      listSandboxes: vi.fn().mockResolvedValue([]),
      connectSandbox: vi.fn().mockResolvedValue({ sandboxId: "sbx-1", run }),
      loadLastRunState: vi.fn().mockResolvedValue(null),
    });

    expect(run).toHaveBeenCalledWith("pwd", { cwd: "/workspace/repo-two" });
  });

  it("selects configured repo cwd when project.active is index", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });
    await runCommandCommand(["--sandbox-id", "sbx-1", "pwd"], {
      loadConfig: vi.fn().mockResolvedValue({
        ...baseConfig,
        project: {
          ...baseConfig.project,
          mode: "single",
          active: "index",
          active_index: 1,
          repos: [
            {
              name: "repo-one",
              url: "https://example.com/repo-one.git",
              branch: "main",
              setup_command: "",
              setup_env: {},
              startup_env: {},
            },
            {
              name: "repo-two",
              url: "https://example.com/repo-two.git",
              branch: "main",
              setup_command: "",
              setup_env: {},
              startup_env: {},
            },
          ],
        },
      }),
      listSandboxes: vi.fn().mockResolvedValue([]),
      connectSandbox: vi.fn().mockResolvedValue({ sandboxId: "sbx-1", run }),
      loadLastRunState: vi.fn().mockResolvedValue(null),
    });

    expect(run).toHaveBeenCalledWith("pwd", { cwd: "/workspace/repo-two" });
  });

  it("selects project dir cwd when no repos are configured", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });
    await runCommandCommand(["--sandbox-id", "sbx-1", "pwd"], {
      loadConfig: vi.fn().mockResolvedValue(baseConfig),
      listSandboxes: vi.fn().mockResolvedValue([]),
      connectSandbox: vi.fn().mockResolvedValue({ sandboxId: "sbx-1", run }),
      loadLastRunState: vi.fn().mockResolvedValue(null),
    });

    expect(run).toHaveBeenCalledWith("pwd", { cwd: "/workspace" });
  });

  it("passes through exit code and formats output sections", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "boom", exitCode: 7 });

    const result = await runCommandCommand(["--sandbox-id", "sbx-1", "--", "npm", "test"], {
      loadConfig: vi.fn().mockResolvedValue(baseConfig),
      listSandboxes: vi.fn().mockResolvedValue([]),
      connectSandbox: vi.fn().mockResolvedValue({ sandboxId: "sbx-1", run }),
      loadLastRunState: vi.fn().mockResolvedValue(null),
    });

    expect(run).toHaveBeenCalledWith("npm test", { cwd: "/workspace" });
    expect(result.exitCode).toBe(7);
    expect(result.message).toContain("Ran command in sandbox sbx-1.");
    expect(result.message).toContain("cwd: /workspace");
    expect(result.message).toContain("stdout:\n(empty)");
    expect(result.message).toContain("stderr:\nboom");
  });

  it("returns structured json output when --json is provided", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "ok\n", stderr: "", exitCode: 0 });

    const result = await runCommandCommand(["--sandbox-id", "sbx-1", "--json", "--", "npm", "test"], {
      loadConfig: vi.fn().mockResolvedValue(baseConfig),
      listSandboxes: vi.fn().mockResolvedValue([]),
      connectSandbox: vi.fn().mockResolvedValue({ sandboxId: "sbx-1", run }),
      loadLastRunState: vi.fn().mockResolvedValue(null),
    });

    expect(result.message).toBe(
      JSON.stringify(
        {
          sandboxId: "sbx-1",
          sandboxLabel: "sbx-1",
          command: "npm test",
          cwd: "/workspace",
          stdout: "ok\n",
          stderr: "",
          exitCode: 0,
        },
        null,
        2,
      ),
    );
    expect(result.exitCode).toBe(0);
  });

  it("injects passthrough envs when running command", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });

    await runCommandCommand(["--sandbox-id", "sbx-1", "env"], {
      loadConfig: vi.fn().mockResolvedValue(baseConfig),
      listSandboxes: vi.fn().mockResolvedValue([]),
      connectSandbox: vi.fn().mockResolvedValue({ sandboxId: "sbx-1", run }),
      resolveEnvSource: vi.fn().mockResolvedValue({ FIRECRAWL_API_KEY: "fc-test", OPENCODE_SERVER_PASSWORD: "abcd" }),
      resolveSandboxCreateEnv: vi
        .fn()
        .mockReturnValue({ envs: { FIRECRAWL_API_KEY: "fc-test", OPENCODE_SERVER_PASSWORD: "abcd" } }),
      loadLastRunState: vi.fn().mockResolvedValue(null),
    });

    expect(run).toHaveBeenCalledWith("env", {
      cwd: "/workspace",
      envs: {
        FIRECRAWL_API_KEY: "fc-test",
      },
    });
  });

  it("logs launcher config path when metadata loader is used", async () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    const run = vi.fn().mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });

    await runCommandCommand(["--sandbox-id", "sbx-1", "pwd"], {
      loadConfig: vi.fn().mockResolvedValue(baseConfig),
      loadConfigWithMetadata: vi.fn().mockResolvedValue({
        config: baseConfig,
        configPath: "/tmp/launcher.config.toml",
        createdConfig: false,
        scope: "local",
      }),
      listSandboxes: vi.fn().mockResolvedValue([]),
      connectSandbox: vi.fn().mockResolvedValue({ sandboxId: "sbx-1", run }),
      loadLastRunState: vi.fn().mockResolvedValue(null),
    });

    expect(infoSpy).toHaveBeenCalledWith("Using launcher config: /tmp/launcher.config.toml");
    infoSpy.mockRestore();
  });
});
