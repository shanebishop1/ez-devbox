import { describe, expect, it, vi } from "vitest";
import {
  connectSandbox,
  createSandbox,
  listSandboxes,
  refreshTimeout,
  type SandboxHandle
} from "../src/e2b/lifecycle.js";
import type { ResolvedLauncherConfig } from "../src/config/schema.js";
import type { E2BClient, E2BSandbox } from "../src/e2b/client.js";

describe("e2b lifecycle adapter", () => {
  const baseConfig: ResolvedLauncherConfig = {
    sandbox: {
      template: "base",
      reuse: true,
      name: "agent-box",
      timeout_ms: 1800_000,
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

  it("createSandbox invokes SDK create with template/timeout/env metadata", async () => {
    const sdkSandbox = createMockSandbox("sbx-create");
    const client = createMockClient({
      create: vi.fn().mockResolvedValue(sdkSandbox)
    });

    await createSandbox(baseConfig, {
      client,
      envs: { GITHUB_TOKEN: "token" },
      metadata: { source: "test" },
      tags: { project: "agent-box", mode: "web", user: "shane" }
    });

    expect(client.create).toHaveBeenCalledWith("base", {
      timeoutMs: 1_800_000,
      envs: { GITHUB_TOKEN: "token" },
      metadata: {
        "launcher.project": "agent-box",
        "launcher.mode": "web",
        "launcher.user": "shane",
        source: "test"
      },
      requestTimeoutMs: undefined
    });
  });

  it("connectSandbox wraps connected sandbox and run maps command output", async () => {
    const run = vi.fn().mockResolvedValue({
      stdout: "ok",
      stderr: "",
      exitCode: 0
    });
    const sdkSandbox = createMockSandbox("sbx-connect", run);
    const client = createMockClient({
      connect: vi.fn().mockResolvedValue(sdkSandbox)
    });

    const handle = await connectSandbox("sbx-connect", baseConfig, { client });
    const result = await handle.run("pwd", {
      cwd: "/workspace",
      envs: { A: "1" },
      timeoutMs: 8_000
    });

    expect(client.connect).toHaveBeenCalledWith("sbx-connect", {
      requestTimeoutMs: undefined
    });
    expect(run).toHaveBeenCalledWith("pwd", { cwd: "/workspace", envs: { A: "1" }, timeoutMs: 8_000 });
    expect(result).toEqual({ stdout: "ok", stderr: "", exitCode: 0 });
  });

  it("listSandboxes maps SDK objects to launcher list shape", async () => {
    const client = createMockClient({
      list: vi.fn().mockResolvedValue([
        {
          sandboxId: "sbx-1",
          state: "running",
          metadata: { "launcher.project": "agent-box" }
        },
        {
          sandboxId: "sbx-2",
          state: "paused",
          metadata: undefined
        }
      ])
    });

    const listed = await listSandboxes({ client, tags: { project: "agent-box" } });

    expect(client.list).toHaveBeenCalledWith({
      metadata: { "launcher.project": "agent-box" },
      requestTimeoutMs: undefined
    });
    expect(listed).toEqual([
      {
        sandboxId: "sbx-1",
        state: "running",
        metadata: { "launcher.project": "agent-box" }
      },
      {
        sandboxId: "sbx-2",
        state: "paused",
        metadata: undefined
      }
    ]);
  });

  it("refreshTimeout normalizes milliseconds and calls setTimeout", async () => {
    const setTimeout = vi.fn().mockResolvedValue(undefined);
    const handle: SandboxHandle = {
      sandboxId: "sbx-timeout",
      run: vi.fn(),
      getHost: vi.fn(),
      setTimeout,
      kill: vi.fn()
    };

    await refreshTimeout(handle, 12_000.75);

    expect(setTimeout).toHaveBeenCalledWith(12_000);
  });

  it("converts SDK failures to readable launcher errors", async () => {
    const sdkSandbox = createMockSandbox("sbx-error", vi.fn().mockRejectedValue(new Error("command crashed")));
    const client = createMockClient({
      connect: vi.fn().mockResolvedValue(sdkSandbox)
    });

    const handle = await connectSandbox("sbx-error", baseConfig, { client });

    await expect(handle.run("false")).rejects.toThrow(
      "Failed to run command in sandbox 'sbx-error': command crashed"
    );
  });
});

function createMockSandbox(
  sandboxId: string,
  run: E2BSandbox["commands"]["run"] = vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 })
): E2BSandbox {
  return {
    sandboxId,
    commands: { run },
    getHost: vi.fn().mockReturnValue(`${sandboxId}.host`),
    setTimeout: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined)
  };
}

function createMockClient(overrides: Partial<E2BClient>): E2BClient {
  return {
    create: overrides.create ?? vi.fn().mockRejectedValue(new Error("create not stubbed")),
    connect: overrides.connect ?? vi.fn().mockRejectedValue(new Error("connect not stubbed")),
    list: overrides.list ?? vi.fn().mockResolvedValue([]),
    kill: overrides.kill ?? vi.fn().mockResolvedValue(true)
  };
}
