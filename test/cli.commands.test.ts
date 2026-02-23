import { describe, expect, it, vi } from "vitest";
import { runConnectCommand } from "../src/cli/commands.connect.js";
import { runCreateCommand } from "../src/cli/commands.create.js";
import { runStartCommand } from "../src/cli/commands.start.js";
import type { ResolvedLauncherConfig } from "../src/config/schema.js";

describe("CLI command integration", () => {
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
    mcp: {
      mode: "disabled",
      firecrawl_api_url: "",
      allow_localhost_override: false
    }
  };

  it("create calls createSandbox + launchMode + saveLastRunState", async () => {
    const createSandbox = vi.fn().mockResolvedValue({ sandboxId: "sbx-created" });
    const launchMode = vi.fn().mockResolvedValue({ mode: "ssh-opencode", command: "opencode", message: "launched" });
    const saveLastRunState = vi.fn().mockResolvedValue(undefined);

    await runCreateCommand([], {
      loadConfig: vi.fn().mockResolvedValue(config),
      createSandbox,
      launchMode,
      saveLastRunState,
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(createSandbox).toHaveBeenCalledTimes(1);
    expect(launchMode).toHaveBeenCalledWith({ sandboxId: "sbx-created" }, "prompt");
    expect(saveLastRunState).toHaveBeenCalledWith({
      sandboxId: "sbx-created",
      mode: "ssh-opencode",
      updatedAt: "2026-02-01T00:00:00.000Z"
    });
  });

  it("connect uses --sandbox-id when provided", async () => {
    const connectSandbox = vi.fn().mockResolvedValue({ sandboxId: "sbx-arg" });
    const launchMode = vi.fn().mockResolvedValue({ mode: "ssh-opencode", command: "opencode", message: "launched" });

    await runConnectCommand(["--sandbox-id", "sbx-arg"], {
      loadConfig: vi.fn().mockResolvedValue(config),
      connectSandbox,
      loadLastRunState: vi.fn().mockResolvedValue({ sandboxId: "sbx-last", mode: "web", updatedAt: "2026-01-01T00:00:00.000Z" }),
      listSandboxes: vi.fn().mockResolvedValue([{ sandboxId: "sbx-list", state: "running" }]),
      launchMode,
      saveLastRunState: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(connectSandbox).toHaveBeenCalledWith("sbx-arg", config);
    expect(launchMode).toHaveBeenCalledWith({ sandboxId: "sbx-arg" }, "prompt");
  });

  it("connect falls back to last-run sandbox id when no --sandbox-id provided", async () => {
    const connectSandbox = vi.fn().mockResolvedValue({ sandboxId: "sbx-last" });

    await runConnectCommand([], {
      loadConfig: vi.fn().mockResolvedValue(config),
      connectSandbox,
      loadLastRunState: vi.fn().mockResolvedValue({ sandboxId: "sbx-last", mode: "web", updatedAt: "2026-01-01T00:00:00.000Z" }),
      listSandboxes: vi.fn().mockResolvedValue([{ sandboxId: "sbx-list", state: "running" }]),
      launchMode: vi.fn().mockResolvedValue({ mode: "web", url: "https://sbx-last.e2b.dev", message: "launched" }),
      saveLastRunState: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(connectSandbox).toHaveBeenCalledWith("sbx-last", config);
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
      saveLastRunState: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(loadLastRunState).not.toHaveBeenCalled();
    expect(listSandboxes).toHaveBeenCalledTimes(1);
    expect(connectSandbox).toHaveBeenCalledWith("sbx-list", config);
  });
});
