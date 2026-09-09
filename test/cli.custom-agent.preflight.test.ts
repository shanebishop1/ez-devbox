import { describe, expect, it, vi } from "vitest";
import { runConnectCommand } from "../src/cli/commands.connect.js";
import type { ConnectCommandDeps } from "../src/cli/commands.connect.types.js";
import type { CreateCommandDeps } from "../src/cli/commands.create.execute.js";
import { runCreateCommand } from "../src/cli/commands.create.js";
import { defaultConfig } from "../src/config/defaults.js";

const invalidCustomAgent = {
  command: ["agent"],
  initial_prompt_command: ["bash", "-c", "{prompt}"],
  follow_up: "tmux" as const,
  files: [],
};

describe("custom agent launch preflight", () => {
  it("rejects a CLI-selected custom mode before creating a sandbox", async () => {
    const createSandbox = vi.fn();
    const withConfiguredTunnel = vi.fn();
    const config = {
      ...defaultConfig,
      startup: { ...defaultConfig.startup, mode: "web" as const },
      agent: invalidCustomAgent,
    };

    await expect(
      runCreateCommand([], {
        ...createDeps(config),
        createSandbox,
        withConfiguredTunnel,
        resolvePromptStartupMode: vi.fn().mockResolvedValue("ssh-custom"),
      } as CreateCommandDeps),
    ).rejects.toThrow("shell");
    expect(createSandbox).not.toHaveBeenCalled();
    expect(withConfiguredTunnel).not.toHaveBeenCalled();
  });

  it("rejects a CLI-selected custom mode before connecting to a sandbox", async () => {
    const connectSandbox = vi.fn();
    const config = {
      ...defaultConfig,
      startup: { ...defaultConfig.startup, mode: "web" as const },
      agent: {
        command: ["agent"],
        initial_prompt_command: ["bash", "-c", "{prompt}"],
        follow_up: "tmux" as const,
        files: [],
      },
    };

    await expect(
      runConnectCommand(["--sandbox-id", "sbx-existing"], {
        ...connectDeps(config),
        connectSandbox,
        resolvePromptStartupMode: vi.fn().mockResolvedValue("ssh-custom"),
      } as ConnectCommandDeps),
    ).rejects.toThrow("shell");
    expect(connectSandbox).not.toHaveBeenCalled();
  });

  it("rejects oversized selected-repository startup env before creating a sandbox", async () => {
    const createSandbox = vi.fn();
    const repo = {
      name: "workspace",
      url: "https://example.com/workspace.git",
      branch: "main",
      setup_command: "",
      setup_env: {},
      startup_env: { CUSTOM_VALUE: "é".repeat(20_000) },
    };
    const config = {
      ...defaultConfig,
      startup: { ...defaultConfig.startup, mode: "ssh-custom" as const },
      agent: { command: ["agent"], files: [] },
      project: { ...defaultConfig.project, repos: [repo] },
    };

    await expect(
      runCreateCommand([], {
        ...createDeps(config),
        createSandbox,
        selectReposForCreate: vi.fn().mockResolvedValue([repo]),
        resolvePromptStartupMode: vi.fn().mockResolvedValue("ssh-custom"),
        withConfiguredTunnel: vi.fn(async (_config, callback) => callback({})),
      } as CreateCommandDeps),
    ).rejects.toThrow(/environment.*bytes/i);
    expect(createSandbox).not.toHaveBeenCalled();
  });
});

function createDeps(config: typeof defaultConfig): Partial<CreateCommandDeps> {
  return {
    loadConfig: vi.fn().mockResolvedValue(config),
    resolveEnvSource: vi.fn().mockResolvedValue({}),
    resolveSandboxCreateEnv: vi.fn().mockReturnValue({ envs: {} }),
    launchMode: vi.fn(),
    syncToolingToSandbox: vi.fn(),
    saveLastRunState: vi.fn(),
    now: () => "2026-01-01T00:00:00.000Z",
    selectReposForCreate: vi.fn().mockResolvedValue([]),
    isInteractiveTerminal: () => false,
  };
}

function connectDeps(config: typeof defaultConfig): Partial<ConnectCommandDeps> {
  return {
    loadConfig: vi.fn().mockResolvedValue(config),
    loadLastRunState: vi.fn().mockResolvedValue(null),
    listSandboxes: vi.fn().mockResolvedValue([]),
    resolvePromptStartupMode: vi.fn().mockResolvedValue("ssh-custom"),
    launchMode: vi.fn(),
    saveLastRunState: vi.fn(),
    now: () => "2026-01-01T00:00:00.000Z",
    isInteractiveTerminal: () => false,
  };
}
