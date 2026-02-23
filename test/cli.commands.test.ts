import { describe, expect, it, vi } from "vitest";
import { runConnectCommand } from "../src/cli/commands.connect.js";
import { runCreateCommand } from "../src/cli/commands.create.js";
import { runStartCommand } from "../src/cli/commands.start.js";
import type { ResolvedLauncherConfig } from "../src/config/schema.js";

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

  const config: ResolvedLauncherConfig = {
    sandbox: {
      template: "base",
      reuse: true,
      name: "agent-box",
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

  it("create auto-selects opencode template for prompt/opencode mode", async () => {
    const createSandbox = vi.fn().mockResolvedValue({ sandboxId: "sbx-created" });
    const launchMode = vi.fn().mockResolvedValue({ mode: "ssh-opencode", command: "opencode", message: "launched" });
    const syncToolingToSandbox = vi.fn().mockResolvedValue(syncSummary);
    const saveLastRunState = vi.fn().mockResolvedValue(undefined);

    await runCreateCommand([], {
      loadConfig: vi.fn().mockResolvedValue(config),
      createSandbox,
      resolveEnvSource: vi.fn().mockResolvedValue({}),
      resolveSandboxCreateEnv: vi.fn().mockReturnValue({ envs: {}, warnings: [] }),
      launchMode,
      syncToolingToSandbox,
      saveLastRunState,
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(createSandbox).toHaveBeenCalledTimes(1);
    expect(createSandbox).toHaveBeenCalledWith(
      {
        ...config,
        sandbox: {
          ...config.sandbox,
          template: "opencode"
        }
      },
      {
      envs: {}
      }
    );
    expect(syncToolingToSandbox).toHaveBeenCalledWith(config, { sandboxId: "sbx-created" }, "ssh-opencode");
    expect(syncToolingToSandbox.mock.invocationCallOrder[0]).toBeLessThan(launchMode.mock.invocationCallOrder[0]);
    expect(launchMode).toHaveBeenCalledWith({ sandboxId: "sbx-created" }, "prompt");
    expect(saveLastRunState).toHaveBeenCalledWith({
      sandboxId: "sbx-created",
      mode: "ssh-opencode",
      updatedAt: "2026-02-01T00:00:00.000Z"
    });
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

    await runCreateCommand(["--mode", "ssh-codex"], {
      loadConfig: vi.fn().mockResolvedValue(config),
      createSandbox,
      resolveEnvSource: vi.fn().mockResolvedValue({}),
      resolveSandboxCreateEnv: vi.fn().mockReturnValue({ envs: {}, warnings: [] }),
      launchMode: vi.fn().mockResolvedValue({ mode: "ssh-codex", command: "codex", message: "launched" }),
      syncToolingToSandbox,
      saveLastRunState: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(createSandbox).toHaveBeenCalledWith(
      {
        ...config,
        sandbox: {
          ...config.sandbox,
          template: "codex"
        }
      },
      {
        envs: {}
      }
    );
    expect(syncToolingToSandbox).toHaveBeenCalledWith(config, { sandboxId: "sbx-created" }, "ssh-codex");
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
      launchMode,
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
    const connectSandbox = vi.fn().mockResolvedValue({ sandboxId: "sbx-arg" });
    const launchMode = vi.fn().mockResolvedValue({ mode: "ssh-opencode", command: "opencode", message: "launched" });
    const syncToolingToSandbox = vi.fn().mockResolvedValue(syncSummary);

    await runConnectCommand(["--sandbox-id", "sbx-arg"], {
      loadConfig: vi.fn().mockResolvedValue(config),
      connectSandbox,
      loadLastRunState: vi.fn().mockResolvedValue({ sandboxId: "sbx-last", mode: "web", updatedAt: "2026-01-01T00:00:00.000Z" }),
      listSandboxes: vi.fn().mockResolvedValue([{ sandboxId: "sbx-list", state: "running" }]),
      launchMode,
      syncToolingToSandbox,
      saveLastRunState: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(connectSandbox).toHaveBeenCalledWith("sbx-arg", config);
    expect(syncToolingToSandbox).toHaveBeenCalledWith(config, { sandboxId: "sbx-arg" }, "ssh-opencode");
    expect(syncToolingToSandbox.mock.invocationCallOrder[0]).toBeLessThan(launchMode.mock.invocationCallOrder[0]);
    expect(launchMode).toHaveBeenCalledWith({ sandboxId: "sbx-arg" }, "prompt");
  });

  it("connect falls back to last-run sandbox id when no --sandbox-id provided", async () => {
    const connectSandbox = vi.fn().mockResolvedValue({ sandboxId: "sbx-last" });
    const syncToolingToSandbox = vi.fn().mockResolvedValue(syncSummary);

    await runConnectCommand([], {
      loadConfig: vi.fn().mockResolvedValue(config),
      connectSandbox,
      loadLastRunState: vi.fn().mockResolvedValue({ sandboxId: "sbx-last", mode: "web", updatedAt: "2026-01-01T00:00:00.000Z" }),
      listSandboxes: vi.fn().mockResolvedValue([{ sandboxId: "sbx-list", state: "running" }]),
      launchMode: vi.fn().mockResolvedValue({ mode: "web", url: "https://sbx-last.e2b.dev", message: "launched" }),
      syncToolingToSandbox,
      saveLastRunState: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(connectSandbox).toHaveBeenCalledWith("sbx-last", config);
    expect(syncToolingToSandbox).toHaveBeenCalledWith(config, { sandboxId: "sbx-last" }, "ssh-opencode");
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
      launchMode: vi.fn().mockResolvedValue({ mode: "ssh-opencode", command: "opencode", message: "launched" }),
      syncToolingToSandbox: vi.fn().mockResolvedValue(syncSummary),
      saveLastRunState: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(loadLastRunState).not.toHaveBeenCalled();
    expect(listSandboxes).toHaveBeenCalledTimes(1);
    expect(connectSandbox).toHaveBeenCalledWith("sbx-list", config);
  });
});
