import { describe, expect, it, vi } from "vitest";
import { runConnectCommand } from "../src/cli/commands.connect.js";
import { runCreateCommand } from "../src/cli/commands.create.js";
import { runStartCommand } from "../src/cli/commands.start.js";
import { buildSandboxDisplayName } from "../src/cli/sandbox-display-name.js";
import type { ResolvedLauncherConfig } from "../src/config/schema.js";
import { logger } from "../src/logging/logger.js";

describe("CLI command integration", () => {
  const syncSummary = {
    totalDiscovered: 2,
    totalWritten: 2,
    skippedMissingPaths: 0,
    opencodeConfigSynced: true,
    opencodeAuthSynced: true,
    codexConfigSynced: false,
    codexAuthSynced: false
  };
  const bootstrapResult = {
    selectedRepoNames: [],
    workingDirectory: undefined,
    startupEnv: {},
    provisionedRepos: [],
    setup: null
  };

  const config: ResolvedLauncherConfig = {
    sandbox: {
      template: "base",
      reuse: true,
      name: "ez-box",
      timeout_ms: 1_800_000,
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
      repos: []
    },
    env: {
      pass_through: []
    },
    opencode: {
      config_dir: "~/.config/opencode",
      auth_path: "~/.local/share/opencode/auth.json"
    },
    codex: {
      config_dir: "~/.codex",
      auth_path: "~/.codex/auth.json"
    },
    mcp: {
      mode: "disabled",
      firecrawl_api_url: "",
      allow_localhost_override: false
    }
  };

  it("create resolves prompt mode using injected selector before template sync/launch", async () => {
    const loggerInfo = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    const createSandbox = vi.fn().mockResolvedValue({ sandboxId: "sbx-created" });
    const launchMode = vi.fn().mockResolvedValue({ mode: "ssh-codex", command: "codex", message: "launched" });
    const syncToolingToSandbox = vi.fn().mockResolvedValue(syncSummary);
    const saveLastRunState = vi.fn().mockResolvedValue(undefined);
    const resolvePromptStartupMode = vi.fn().mockResolvedValue("ssh-codex");
    const displayName = buildSandboxDisplayName(config.project.repos, "2026-02-01T00:00:00.000Z");

    const result = await runCreateCommand([], {
      loadConfig: vi.fn().mockResolvedValue(config),
      createSandbox,
      resolveEnvSource: vi.fn().mockResolvedValue({}),
      resolveSandboxCreateEnv: vi.fn().mockReturnValue({ envs: {}, warnings: [] }),
      resolvePromptStartupMode,
      launchMode,
      bootstrapProjectWorkspace: vi.fn().mockResolvedValue(bootstrapResult),
      syncToolingToSandbox,
      saveLastRunState,
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(createSandbox).toHaveBeenCalledTimes(1);
    expect(resolvePromptStartupMode).toHaveBeenCalledWith("prompt");
    expect(createSandbox).toHaveBeenCalledWith(
      {
        ...config,
        sandbox: {
          ...config.sandbox,
          template: "codex"
        }
      },
      {
        envs: {},
        metadata: {
          "launcher.name": displayName
        }
      }
    );
    expect(syncToolingToSandbox).toHaveBeenCalledWith(config, { sandboxId: "sbx-created" }, "ssh-codex");
    expect(syncToolingToSandbox.mock.invocationCallOrder[0]).toBeLessThan(launchMode.mock.invocationCallOrder[0]);
    expect(launchMode).toHaveBeenCalledWith({ sandboxId: "sbx-created" }, "ssh-codex", {
      workingDirectory: undefined,
      startupEnv: {}
    });
    expect(loggerInfo).toHaveBeenCalledWith("Startup mode selected via prompt: ssh-codex.");
    expect(saveLastRunState).toHaveBeenCalledWith({
      sandboxId: "sbx-created",
      mode: "ssh-codex",
      activeRepo: undefined,
      updatedAt: "2026-02-01T00:00:00.000Z"
    });
    expect(result.message).toContain(`Created sandbox ${displayName} (sbx-created).`);
    loggerInfo.mockRestore();
  });

  it("create auto-selects codex template for ssh-codex mode", async () => {
    const createSandbox = vi.fn().mockResolvedValue({ sandboxId: "sbx-created" });
    const syncToolingToSandbox = vi.fn().mockResolvedValue({
      ...syncSummary,
      opencodeConfigSynced: false,
      opencodeAuthSynced: false,
      codexConfigSynced: true,
      codexAuthSynced: true
    });
    const resolvePromptStartupMode = vi.fn().mockImplementation(async (mode: string) => mode);
    const displayName = buildSandboxDisplayName(config.project.repos, "2026-02-01T00:00:00.000Z");

    await runCreateCommand(["--mode", "ssh-codex"], {
      loadConfig: vi.fn().mockResolvedValue(config),
      createSandbox,
      resolveEnvSource: vi.fn().mockResolvedValue({}),
      resolveSandboxCreateEnv: vi.fn().mockReturnValue({ envs: {}, warnings: [] }),
      resolvePromptStartupMode,
      launchMode: vi.fn().mockResolvedValue({ mode: "ssh-codex", command: "codex", message: "launched" }),
      bootstrapProjectWorkspace: vi.fn().mockResolvedValue(bootstrapResult),
      syncToolingToSandbox,
      saveLastRunState: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(resolvePromptStartupMode).toHaveBeenCalledWith("ssh-codex");
    expect(createSandbox).toHaveBeenCalledWith(
      {
        ...config,
        sandbox: {
          ...config.sandbox,
          template: "codex"
        }
      },
      {
        envs: {},
        metadata: {
          "launcher.name": displayName
        }
      }
    );
    expect(syncToolingToSandbox).toHaveBeenCalledWith(config, { sandboxId: "sbx-created" }, "ssh-codex");
  });

  it("create uses single configured repo and branch in launcher.name metadata", async () => {
    const singleRepoConfig: ResolvedLauncherConfig = {
      ...config,
      project: {
        ...config.project,
        repos: [
          {
            name: "next.js",
            url: "https://github.com/vercel/next.js.git",
            branch: "canary",
            setup_command: "",
            setup_env: {},
            startup_env: {}
          }
        ]
      }
    };
    const createSandbox = vi.fn().mockResolvedValue({ sandboxId: "sbx-created" });

    await runCreateCommand(["--mode", "web"], {
      loadConfig: vi.fn().mockResolvedValue(singleRepoConfig),
      createSandbox,
      resolveEnvSource: vi.fn().mockResolvedValue({}),
      resolveSandboxCreateEnv: vi.fn().mockReturnValue({ envs: {}, warnings: [] }),
      resolvePromptStartupMode: vi.fn().mockResolvedValue("web"),
      launchMode: vi.fn().mockResolvedValue({ mode: "web", url: "https://sbx-created.e2b.dev", message: "launched" }),
      bootstrapProjectWorkspace: vi.fn().mockResolvedValue(bootstrapResult),
      syncToolingToSandbox: vi.fn().mockResolvedValue(syncSummary),
      saveLastRunState: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(createSandbox).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        metadata: {
            "launcher.name": "next.js canary 2026-02-01 00:00:00 UTC"
        }
      })
    );
  });

  it("create includes MCP warnings in output message", async () => {
    const createSandbox = vi.fn().mockResolvedValue({ sandboxId: "sbx-created" });
    const launchMode = vi.fn().mockResolvedValue({ mode: "ssh-opencode", command: "opencode", message: "launched" });
    const syncToolingToSandbox = vi.fn().mockResolvedValue(syncSummary);
    const resolveEnvSource = vi.fn().mockResolvedValue({ OPENCODE_SERVER_PASSWORD: "from-dotenv" });
    const resolveSandboxCreateEnv = vi
      .fn()
      .mockReturnValue({
        envs: {
          OPENCODE_SERVER_PASSWORD: "from-dotenv"
        },
        warnings: []
      });

    const result = await runCreateCommand([], {
      loadConfig: vi.fn().mockResolvedValue({
        ...config,
        mcp: {
          mode: "in_sandbox",
          firecrawl_api_url: "",
          allow_localhost_override: false
        }
      }),
      createSandbox,
      resolveEnvSource,
      resolveSandboxCreateEnv: resolveSandboxCreateEnv.mockReturnValue({
        envs: {
          OPENCODE_SERVER_PASSWORD: "from-dotenv"
        },
        warnings: [
          "mcp.mode='in_sandbox' is advanced and not fully implemented yet. Provide mcp.firecrawl_api_url or FIRECRAWL_API_URL to use a known remote endpoint."
        ]
      }),
      resolvePromptStartupMode: vi.fn().mockResolvedValue("ssh-opencode"),
      launchMode,
      bootstrapProjectWorkspace: vi.fn().mockResolvedValue(bootstrapResult),
      syncToolingToSandbox,
      saveLastRunState: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(resolveEnvSource).toHaveBeenCalledTimes(1);
    expect(resolveSandboxCreateEnv).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ OPENCODE_SERVER_PASSWORD: "from-dotenv" })
    );

    expect(result.message).toContain("MCP warnings:");
    expect(result.message).toContain("mcp.mode='in_sandbox' is advanced and not fully implemented yet");
    expect(result.message).toContain("Tooling sync: discovered=2, written=2, missingPaths=0, opencodeSynced=true, codexSynced=false");
  });

  it("connect uses --sandbox-id when provided", async () => {
    const loggerInfo = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    const connectSandbox = vi.fn().mockResolvedValue({ sandboxId: "sbx-arg" });
    const launchMode = vi.fn().mockResolvedValue({ mode: "ssh-opencode", command: "opencode", message: "launched" });
    const syncToolingToSandbox = vi.fn().mockResolvedValue(syncSummary);
    const resolvePromptStartupMode = vi.fn().mockResolvedValue("ssh-opencode");
    const bootstrapProjectWorkspace = vi.fn().mockImplementation(async (_handle, _config, options) => {
      options?.onProgress?.("Repo clone: /workspace/alpha");
      return bootstrapResult;
    });

    await runConnectCommand(["--sandbox-id", "sbx-arg"], {
      loadConfig: vi.fn().mockResolvedValue(config),
      connectSandbox,
      loadLastRunState: vi.fn().mockResolvedValue({ sandboxId: "sbx-last", mode: "web", updatedAt: "2026-01-01T00:00:00.000Z" }),
      listSandboxes: vi.fn().mockResolvedValue([{ sandboxId: "sbx-list", state: "running" }]),
      resolvePromptStartupMode,
      launchMode,
      bootstrapProjectWorkspace,
      syncToolingToSandbox,
      saveLastRunState: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(connectSandbox).toHaveBeenCalledWith("sbx-arg", config);
    expect(resolvePromptStartupMode).toHaveBeenCalledWith("prompt");
    expect(syncToolingToSandbox).toHaveBeenCalledWith(config, { sandboxId: "sbx-arg" }, "ssh-opencode");
    expect(syncToolingToSandbox.mock.invocationCallOrder[0]).toBeLessThan(launchMode.mock.invocationCallOrder[0]);
    expect(loggerInfo).toHaveBeenCalledWith("Bootstrap: Repo clone: /workspace/alpha");
    expect(launchMode).toHaveBeenCalledWith({ sandboxId: "sbx-arg" }, "ssh-opencode", {
      workingDirectory: undefined,
      startupEnv: {}
    });
    expect(loggerInfo).toHaveBeenCalledWith("Startup mode selected via prompt: ssh-opencode.");
    loggerInfo.mockRestore();
  });

  it("connect uses the only listed sandbox when exactly one exists", async () => {
    const connectSandbox = vi.fn().mockResolvedValue({ sandboxId: "sbx-list" });
    const loadLastRunState = vi.fn().mockResolvedValue({ sandboxId: "sbx-last", mode: "web", updatedAt: "2026-01-01T00:00:00.000Z" });
    const syncToolingToSandbox = vi.fn().mockResolvedValue(syncSummary);

    await runConnectCommand([], {
      loadConfig: vi.fn().mockResolvedValue(config),
      connectSandbox,
      loadLastRunState,
      listSandboxes: vi.fn().mockResolvedValue([{ sandboxId: "sbx-list", state: "running" }]),
      resolvePromptStartupMode: vi.fn().mockResolvedValue("ssh-opencode"),
      launchMode: vi.fn().mockResolvedValue({ mode: "web", url: "https://sbx-last.e2b.dev", message: "launched" }),
      bootstrapProjectWorkspace: vi.fn().mockResolvedValue(bootstrapResult),
      syncToolingToSandbox,
      saveLastRunState: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(connectSandbox).toHaveBeenCalledWith("sbx-list", config);
    expect(syncToolingToSandbox).toHaveBeenCalledWith(config, { sandboxId: "sbx-list" }, "ssh-opencode");
    expect(loadLastRunState).not.toHaveBeenCalled();
  });

  it("connect prompts for selection when multiple sandboxes exist in interactive terminals", async () => {
    const connectSandbox = vi.fn().mockResolvedValue({ sandboxId: "sbx-2" });
    const promptInput = vi.fn().mockResolvedValue("2");

    const result = await runConnectCommand([], {
      loadConfig: vi.fn().mockResolvedValue(config),
      connectSandbox,
      loadLastRunState: vi.fn().mockResolvedValue({ sandboxId: "sbx-1", mode: "web", updatedAt: "2026-01-01T00:00:00.000Z" }),
      listSandboxes: vi.fn().mockResolvedValue([
        { sandboxId: "sbx-1", state: "running", metadata: { "launcher.name": "Repo One main 2026-02-01 00:00 UTC" } },
        { sandboxId: "sbx-2", state: "running", metadata: { "launcher.name": "Repo Two canary 2026-02-01 00:01 UTC" } }
      ]),
      resolvePromptStartupMode: vi.fn().mockResolvedValue("ssh-opencode"),
      launchMode: vi.fn().mockResolvedValue({ mode: "ssh-opencode", command: "opencode", message: "launched" }),
      bootstrapProjectWorkspace: vi.fn().mockResolvedValue(bootstrapResult),
      syncToolingToSandbox: vi.fn().mockResolvedValue(syncSummary),
      saveLastRunState: vi.fn().mockResolvedValue(undefined),
      isInteractiveTerminal: () => true,
      promptInput,
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(promptInput).toHaveBeenCalledWith(
      [
        "Multiple sandboxes available. Select one:",
        "1) Repo One main 2026-02-01 00:00 UTC (sbx-1)",
        "2) Repo Two canary 2026-02-01 00:01 UTC (sbx-2)",
        "Enter choice [1-2]: "
      ].join("\n")
    );
    expect(connectSandbox).toHaveBeenCalledWith("sbx-2", config);
    expect(result.message).toContain("Connected to sandbox Repo Two canary 2026-02-01 00:01 UTC (sbx-2).");
  });

  it("connect uses last-run sandbox in non-interactive terminals when sandbox still exists", async () => {
    const connectSandbox = vi.fn().mockResolvedValue({ sandboxId: "sbx-2" });

    await runConnectCommand([], {
      loadConfig: vi.fn().mockResolvedValue(config),
      connectSandbox,
      loadLastRunState: vi.fn().mockResolvedValue({ sandboxId: "sbx-2", mode: "web", updatedAt: "2026-01-01T00:00:00.000Z" }),
      listSandboxes: vi.fn().mockResolvedValue([
        { sandboxId: "sbx-1", state: "running" },
        { sandboxId: "sbx-2", state: "running" }
      ]),
      resolvePromptStartupMode: vi.fn().mockResolvedValue("ssh-opencode"),
      launchMode: vi.fn().mockResolvedValue({ mode: "ssh-opencode", command: "opencode", message: "launched" }),
      bootstrapProjectWorkspace: vi.fn().mockResolvedValue(bootstrapResult),
      syncToolingToSandbox: vi.fn().mockResolvedValue(syncSummary),
      saveLastRunState: vi.fn().mockResolvedValue(undefined),
      isInteractiveTerminal: () => false,
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(connectSandbox).toHaveBeenCalledWith("sbx-2", config);
  });

  it("connect errors in non-interactive terminals when multiple sandboxes exist and no matching last-run", async () => {
    await expect(
      runConnectCommand([], {
        loadConfig: vi.fn().mockResolvedValue(config),
        connectSandbox: vi.fn(),
        loadLastRunState: vi.fn().mockResolvedValue({ sandboxId: "sbx-missing", mode: "web", updatedAt: "2026-01-01T00:00:00.000Z" }),
        listSandboxes: vi.fn().mockResolvedValue([
          { sandboxId: "sbx-1", state: "running" },
          { sandboxId: "sbx-2", state: "running" }
        ]),
        resolvePromptStartupMode: vi.fn().mockResolvedValue("ssh-opencode"),
        launchMode: vi.fn(),
        bootstrapProjectWorkspace: vi.fn().mockResolvedValue(bootstrapResult),
        syncToolingToSandbox: vi.fn().mockResolvedValue(syncSummary),
        saveLastRunState: vi.fn().mockResolvedValue(undefined),
        isInteractiveTerminal: () => false,
        now: () => "2026-02-01T00:00:00.000Z"
      })
    ).rejects.toThrow("Re-run with --sandbox-id <sandbox-id>");
  });

  it("connect logs named fallback sandbox label when selected from list", async () => {
    const loggerInfo = vi.spyOn(logger, "info").mockImplementation(() => undefined);
    const connectSandbox = vi.fn().mockResolvedValue({ sandboxId: "sbx-list" });

    const result = await runConnectCommand(
      [],
      {
        loadConfig: vi.fn().mockResolvedValue(config),
        connectSandbox,
        loadLastRunState: vi.fn().mockResolvedValue(null),
        listSandboxes: vi.fn().mockResolvedValue([
          {
            sandboxId: "sbx-list",
            state: "running",
            metadata: { "launcher.name": "Agent Box web 2026-02-01 00:00 UTC" }
          }
        ]),
        resolvePromptStartupMode: vi.fn().mockResolvedValue("ssh-opencode"),
        launchMode: vi.fn().mockResolvedValue({ mode: "ssh-opencode", command: "opencode", message: "launched" }),
        bootstrapProjectWorkspace: vi.fn().mockResolvedValue(bootstrapResult),
        syncToolingToSandbox: vi.fn().mockResolvedValue(syncSummary),
        saveLastRunState: vi.fn().mockResolvedValue(undefined),
        now: () => "2026-02-01T00:00:00.000Z"
      },
      { skipLastRun: true }
    );

    expect(connectSandbox).toHaveBeenCalledWith("sbx-list", config);
    expect(loggerInfo).toHaveBeenCalledWith("Selected fallback sandbox: Agent Box web 2026-02-01 00:00 UTC (sbx-list).");
    expect(result.message).toContain("Connected to sandbox Agent Box web 2026-02-01 00:00 UTC (sbx-list).");
    loggerInfo.mockRestore();
  });

  it("create bootstraps project workspace and forwards cwd/env to launch", async () => {
    const launchMode = vi.fn().mockResolvedValue({ mode: "ssh-opencode", command: "opencode", message: "launched" });
    const saveLastRunState = vi.fn().mockResolvedValue(undefined);
    const bootstrapProjectWorkspace = vi.fn().mockResolvedValue({
      selectedRepoNames: ["alpha"],
      workingDirectory: "/workspace/alpha",
      startupEnv: { NEXT_PUBLIC_APP_ENV: "preview" },
      provisionedRepos: [{ repo: "alpha", path: "/workspace/alpha", cloned: true, reused: false, branchSwitched: false }],
      setup: { success: true, repos: [] }
    });

    await runCreateCommand(["--mode", "ssh-opencode"], {
      loadConfig: vi.fn().mockResolvedValue(config),
      createSandbox: vi.fn().mockResolvedValue({ sandboxId: "sbx-created" }),
      resolveEnvSource: vi.fn().mockResolvedValue({}),
      resolveSandboxCreateEnv: vi.fn().mockReturnValue({ envs: {}, warnings: [] }),
      resolvePromptStartupMode: vi.fn().mockResolvedValue("ssh-opencode"),
      launchMode,
      bootstrapProjectWorkspace,
      syncToolingToSandbox: vi.fn().mockResolvedValue(syncSummary),
      saveLastRunState,
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(bootstrapProjectWorkspace).toHaveBeenCalledWith(
      { sandboxId: "sbx-created" },
      config,
      expect.objectContaining({ isConnect: false, onProgress: expect.any(Function) })
    );
    expect(launchMode).toHaveBeenCalledWith({ sandboxId: "sbx-created" }, "ssh-opencode", {
      workingDirectory: "/workspace/alpha",
      startupEnv: { NEXT_PUBLIC_APP_ENV: "preview" }
    });
    expect(saveLastRunState).toHaveBeenCalledWith({
      sandboxId: "sbx-created",
      mode: "ssh-opencode",
      activeRepo: "alpha",
      updatedAt: "2026-02-01T00:00:00.000Z"
    });
  });

  it("connect bootstraps project workspace and tracks active repo", async () => {
    const launchMode = vi.fn().mockResolvedValue({ mode: "ssh-opencode", command: "opencode", message: "launched" });
    const saveLastRunState = vi.fn().mockResolvedValue(undefined);
    const bootstrapProjectWorkspace = vi.fn().mockResolvedValue({
      selectedRepoNames: ["alpha"],
      workingDirectory: "/workspace/alpha",
      startupEnv: { NEXT_PUBLIC_APP_ENV: "preview" },
      provisionedRepos: [{ repo: "alpha", path: "/workspace/alpha", cloned: false, reused: true, branchSwitched: false }],
      setup: null
    });

    await runConnectCommand(["--sandbox-id", "sbx-arg"], {
      loadConfig: vi.fn().mockResolvedValue(config),
      connectSandbox: vi.fn().mockResolvedValue({ sandboxId: "sbx-arg" }),
      loadLastRunState: vi.fn().mockResolvedValue(null),
      listSandboxes: vi.fn().mockResolvedValue([]),
      resolvePromptStartupMode: vi.fn().mockResolvedValue("ssh-opencode"),
      launchMode,
      bootstrapProjectWorkspace,
      syncToolingToSandbox: vi.fn().mockResolvedValue(syncSummary),
      saveLastRunState,
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(bootstrapProjectWorkspace).toHaveBeenCalledWith(
      { sandboxId: "sbx-arg" },
      config,
      expect.objectContaining({ isConnect: true, onProgress: expect.any(Function) })
    );
    expect(launchMode).toHaveBeenCalledWith({ sandboxId: "sbx-arg" }, "ssh-opencode", {
      workingDirectory: "/workspace/alpha",
      startupEnv: { NEXT_PUBLIC_APP_ENV: "preview" }
    });
    expect(saveLastRunState).toHaveBeenCalledWith({
      sandboxId: "sbx-arg",
      mode: "ssh-opencode",
      activeRepo: "alpha",
      updatedAt: "2026-02-01T00:00:00.000Z"
    });
  });

  it("start bypasses last-run lookup with --no-reuse", async () => {
    const loadLastRunState = vi.fn().mockResolvedValue({ sandboxId: "sbx-last", mode: "web", updatedAt: "2026-01-01T00:00:00.000Z" });
    const listSandboxes = vi.fn().mockResolvedValue([{ sandboxId: "sbx-list", state: "running" }]);
    const connectSandbox = vi.fn().mockResolvedValue({ sandboxId: "sbx-list" });

    await runStartCommand(["--no-reuse"], {
      loadConfig: vi.fn().mockResolvedValue(config),
      connectSandbox,
      loadLastRunState,
      listSandboxes,
      resolvePromptStartupMode: vi.fn().mockResolvedValue("ssh-opencode"),
      launchMode: vi.fn().mockResolvedValue({ mode: "ssh-opencode", command: "opencode", message: "launched" }),
      bootstrapProjectWorkspace: vi.fn().mockResolvedValue(bootstrapResult),
      syncToolingToSandbox: vi.fn().mockResolvedValue(syncSummary),
      saveLastRunState: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(loadLastRunState).not.toHaveBeenCalled();
    expect(listSandboxes).toHaveBeenCalledTimes(1);
    expect(connectSandbox).toHaveBeenCalledWith("sbx-list", config);
  });
});
