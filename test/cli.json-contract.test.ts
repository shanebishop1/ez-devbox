import { describe, expect, it, vi } from "vitest";
import { runCommandCommand } from "../src/cli/commands.command.js";
import { runConnectCommand } from "../src/cli/commands.connect.js";
import { runCreateCommand } from "../src/cli/commands.create.js";
import { runListCommand } from "../src/cli/commands.list.js";
import type { ResolvedLauncherConfig } from "../src/config/schema.js";

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
  claude: {
    config_dir: "~/.claude",
    state_path: "~/.claude.json",
  },
  gh: {
    enabled: false,
    config_dir: "~/.config/gh",
  },
  tunnel: {
    ports: [],
  },
};

describe("CLI JSON output contracts", () => {
  it("list --json returns stable envelope and item fields", async () => {
    const result = await runListCommand(["--json"], {
      listSandboxes: vi.fn().mockResolvedValue([
        {
          sandboxId: "sbx-1",
          state: "running",
          metadata: { "launcher.name": "Alpha", "launcher.project": "demo" },
        },
        {
          sandboxId: "sbx-2",
          state: "paused",
        },
      ]),
    });

    const parsed = JSON.parse(result.message) as {
      sandboxes: Array<{ sandboxId: string; label: string; state: string; metadata: Record<string, string> }>;
    };

    expect(result.exitCode).toBe(0);
    expect(Object.keys(parsed)).toEqual(["sandboxes"]);
    expect(parsed.sandboxes).toHaveLength(2);
    expect(parsed.sandboxes[0]).toEqual({
      sandboxId: "sbx-1",
      label: "Alpha (sbx-1)",
      state: "running",
      metadata: { "launcher.name": "Alpha", "launcher.project": "demo" },
    });
    expect(parsed.sandboxes[1]).toEqual({
      sandboxId: "sbx-2",
      label: "sbx-2",
      state: "paused",
      metadata: {},
    });
  });

  it("command --json returns stable execution payload", async () => {
    const run = vi.fn().mockResolvedValue({
      stdout: "ok\n",
      stderr: "",
      exitCode: 0,
    });

    const result = await runCommandCommand(["--sandbox-id", "sbx-1", "--json", "--", "npm", "test"], {
      loadConfig: vi.fn().mockResolvedValue(baseConfig),
      listSandboxes: vi.fn().mockResolvedValue([]),
      connectSandbox: vi.fn().mockResolvedValue({ sandboxId: "sbx-1", run }),
      loadLastRunState: vi.fn().mockResolvedValue(null),
    });

    const parsed = JSON.parse(result.message) as Record<string, unknown>;

    expect(result.exitCode).toBe(0);
    expect(Object.keys(parsed)).toEqual([
      "sandboxId",
      "sandboxLabel",
      "command",
      "cwd",
      "stdout",
      "stderr",
      "exitCode",
    ]);
    expect(parsed.sandboxId).toBe("sbx-1");
    expect(parsed.sandboxLabel).toBe("sbx-1");
    expect(parsed.command).toBe("npm test");
    expect(parsed.cwd).toBe("/workspace");
    expect(parsed.stdout).toBe("ok\n");
    expect(parsed.stderr).toBe("");
    expect(parsed.exitCode).toBe(0);
  });

  it("create --json includes optional url and omits undefined command", async () => {
    const syncSummary = {
      totalDiscovered: 0,
      totalWritten: 0,
      totalUnchanged: 0,
      totalMissingPaths: 0,
      skippedMissingPaths: 0,
      opencodeConfigSynced: false,
      opencodeAuthSynced: false,
      codexConfigSynced: false,
      codexAuthSynced: false,
      claudeConfigSynced: false,
      claudeStateSynced: false,
      ghEnabled: false,
      ghConfigSynced: false,
    };

    const result = await runCreateCommand(["--mode", "web", "--json"], {
      loadConfig: vi.fn().mockResolvedValue(baseConfig),
      createSandbox: vi.fn().mockResolvedValue({ sandboxId: "sbx-created" }),
      resolveEnvSource: vi.fn().mockResolvedValue({}),
      resolveSandboxCreateEnv: vi.fn().mockReturnValue({ envs: {} }),
      resolvePromptStartupMode: vi.fn().mockResolvedValue("web"),
      launchMode: vi.fn().mockResolvedValue({ mode: "web", url: "https://sbx-created.e2b.app", message: "launched" }),
      bootstrapProjectWorkspace: vi.fn().mockResolvedValue({
        selectedRepoNames: ["alpha"],
        workingDirectory: "/workspace/alpha",
        startupEnv: {},
        provisionedRepos: [],
        setup: null,
      }),
      syncToolingToSandbox: vi.fn().mockResolvedValue(syncSummary),
      saveLastRunState: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-02-01T00:00:00.000Z",
    });

    const parsed = JSON.parse(result.message) as Record<string, unknown>;

    expect(result.exitCode).toBe(0);
    expect(Object.keys(parsed).sort()).toEqual(
      [
        "activeRepo",
        "mode",
        "sandboxId",
        "sandboxLabel",
        "setup",
        "template",
        "toolingSync",
        "url",
        "workingDirectory",
      ].sort(),
    );
    expect(parsed.sandboxId).toBe("sbx-created");
    expect(parsed.mode).toBe("web");
    expect(parsed.url).toBe("https://sbx-created.e2b.app");
    expect(parsed.workingDirectory).toBe("/workspace/alpha");
    expect(parsed.activeRepo).toBe("alpha");
    expect(parsed.template).toBe("opencode");
    expect(parsed).not.toHaveProperty("command");
  });

  it("connect --json includes optional command and omits undefined url", async () => {
    const result = await runConnectCommand(["--sandbox-id", "sbx-1", "--mode", "ssh-opencode", "--json"], {
      loadConfig: vi.fn().mockResolvedValue(baseConfig),
      connectSandbox: vi.fn().mockResolvedValue({ sandboxId: "sbx-1" }),
      loadLastRunState: vi.fn().mockResolvedValue(null),
      listSandboxes: vi.fn().mockResolvedValue([]),
      resolvePromptStartupMode: vi.fn().mockResolvedValue("ssh-opencode"),
      launchMode: vi.fn().mockResolvedValue({ mode: "ssh-opencode", command: "opencode", message: "launched" }),
      resolveEnvSource: vi.fn().mockResolvedValue({}),
      resolveSandboxCreateEnv: vi.fn().mockReturnValue({ envs: {} }),
      bootstrapProjectWorkspace: vi.fn().mockResolvedValue({
        selectedRepoNames: [],
        workingDirectory: "/workspace",
        startupEnv: {},
        provisionedRepos: [],
        setup: null,
      }),
      saveLastRunState: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-02-01T00:00:00.000Z",
    });

    const parsed = JSON.parse(result.message) as Record<string, unknown>;

    expect(result.exitCode).toBe(0);
    expect(Object.keys(parsed).sort()).toEqual(
      ["command", "mode", "sandboxId", "sandboxLabel", "setup", "workingDirectory"].sort(),
    );
    expect(parsed.sandboxId).toBe("sbx-1");
    expect(parsed.mode).toBe("ssh-opencode");
    expect(parsed.command).toBe("opencode");
    expect(parsed.workingDirectory).toBe("/workspace");
    expect(parsed).not.toHaveProperty("activeRepo");
    expect(parsed).not.toHaveProperty("url");
  });
});
