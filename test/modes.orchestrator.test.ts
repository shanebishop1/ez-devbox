import { describe, expect, it, vi } from "vitest";
import type { SandboxHandle } from "../src/e2b/lifecycle.js";
import { startClaudeMode } from "../src/modes/claude.js";
import { startCodexMode } from "../src/modes/codex.js";
import { launchMode } from "../src/modes/index.js";
import { startOpenCodeMode } from "../src/modes/opencode.js";
import { startShellMode } from "../src/modes/shell.js";

describe("persistent startup modes", () => {
  it("detached Codex startup creates a real tmux session and returns connection details", async () => {
    const run = vi.fn().mockResolvedValueOnce(ok("PRESENT")).mockResolvedValueOnce(ok("CREATED"));
    const result = await startCodexMode(createHandle({ run }), { detach: true });

    expect(String(run.mock.calls[1]?.[0])).toContain("new-session -d");
    expect(String(run.mock.calls[1]?.[0])).toContain("ez-devbox-codex");
    expect(result).toMatchObject({
      mode: "ssh-codex",
      readiness: "ready",
      attachment: "detached",
      connection: {
        type: "tmux",
        socketName: "ez-devbox-codex",
        sessionName: "ez-devbox-codex",
      },
    });
  });

  it("repeated startup reuses an existing tmux session", async () => {
    const run = vi.fn().mockResolvedValueOnce(ok("PRESENT")).mockResolvedValueOnce(ok("EXISTING"));
    const result = await startCodexMode(createHandle({ run }), { detach: true });
    expect(result.details).toEqual({ session: "existing", status: "ready" });
  });

  it("starts and checks the OpenCode server before creating its attach session", async () => {
    const run = vi.fn().mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok("CREATED"));
    const result = await startOpenCodeMode(createHandle({ run }), { detach: true });

    expect(String(run.mock.calls[0]?.[0])).toContain("opencode serve --hostname 127.0.0.1 --port 4096");
    expect(String(run.mock.calls[1]?.[0])).toContain("global/health api/health");
    expect(run.mock.calls[1]?.[1]).toMatchObject({ timeoutMs: 0 });
    expect(String(run.mock.calls[2]?.[0])).toContain("opencode attach http://127.0.0.1:4096");
    expect(run.mock.calls.some(([command]) => String(command).includes("opencode --version"))).toBe(false);
    expect(result.connection).toMatchObject({ type: "tmux", socketName: "ez-devbox-opencode" });
  });

  it("passes an initial Codex prompt through a staged file without embedding it in commands", async () => {
    const prompt = "first line\n$HOME `do-not-run` 'quoted'";
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const run = vi.fn().mockResolvedValueOnce(ok("PRESENT")).mockResolvedValueOnce(ok("CREATED"));

    await startCodexMode(createHandle({ run, writeFile }), {
      detach: true,
      prompt: { kind: "initial", text: prompt },
    });

    expect(writeFile).toHaveBeenCalledWith(expect.stringContaining("ez-devbox-initial-prompt-"), prompt);
    expect(run.mock.calls.map(([command]) => String(command)).join("\n")).not.toContain(prompt);
    expect(String(run.mock.calls[1]?.[0])).toContain("exec codex");
  });

  it("sends follow-ups with tmux load-buffer/paste-buffer", async () => {
    const prompt = "line one\nline two; $(safe-as-data)";
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const run = vi
      .fn()
      .mockResolvedValueOnce(ok("PRESENT"))
      .mockResolvedValueOnce(ok("EXISTING"))
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(ok());

    await startCodexMode(createHandle({ run, writeFile }), {
      detach: true,
      prompt: { kind: "follow-up", text: prompt },
    });

    expect(writeFile).toHaveBeenCalledWith(expect.stringContaining("ez-devbox-prompt-"), prompt);
    expect(String(run.mock.calls[2]?.[0])).toContain("load-buffer");
    expect(String(run.mock.calls[2]?.[0])).toContain("paste-buffer");
    expect(String(run.mock.calls[2]?.[0])).not.toContain(prompt);
  });

  it("explicitly rejects prompt input for shell mode", async () => {
    await expect(
      startShellMode(createHandle({ run: vi.fn() }), {
        detach: true,
        prompt: { kind: "initial", text: "hello" },
      }),
    ).rejects.toThrow("not supported in ssh-shell mode");
  });

  it("interactive startup attaches to the already-created session", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(ok("PRESENT"))
      .mockResolvedValueOnce(ok("CREATED"))
      .mockResolvedValueOnce(ok());
    const runInteractiveSession = vi.fn().mockResolvedValue(undefined);
    await startCodexMode(
      createHandle({ run }),
      {},
      {
        isInteractiveTerminal: () => true,
        prepareSession: vi
          .fn()
          .mockResolvedValue({ tempDir: "/tmp/bridge", privateKeyPath: "/tmp/key", wsUrl: "wss://host" }),
        runInteractiveSession,
        cleanupSession: vi.fn().mockResolvedValue(undefined),
      },
    );
    expect(String(runInteractiveSession.mock.calls[0]?.[1])).toContain("attach-session");
    expect(String(runInteractiveSession.mock.calls[0]?.[1])).not.toContain("new-session");
  });

  it("installs Codex when missing before starting the session", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(ok("MISSING"))
      .mockResolvedValueOnce(ok("installed"))
      .mockResolvedValueOnce(ok("PRESENT"))
      .mockResolvedValueOnce(ok("CREATED"));
    await startCodexMode(createHandle({ run }), { detach: true });
    expect(run).toHaveBeenNthCalledWith(2, "npm i -g @openai/codex", { timeoutMs: 120_000 });
  });

  it("installs Claude when missing before starting the session", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(ok("MISSING"))
      .mockResolvedValueOnce(ok("installed"))
      .mockResolvedValueOnce(ok("PRESENT"))
      .mockResolvedValueOnce(ok("CREATED"));
    await startClaudeMode(createHandle({ run }), { detach: true });
    expect(String(run.mock.calls[1]?.[0])).toContain("claude.ai/install.sh");
  });

  it("web mode remains a ready HTTP endpoint and rejects prompt input", async () => {
    const run = vi.fn().mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok()).mockResolvedValueOnce(ok("401"));
    const result = await launchMode(createHandle({ run, getHost: vi.fn().mockResolvedValue("box.e2b.app") }), "web");
    expect(result).toMatchObject({
      readiness: "ready",
      attachment: "not-applicable",
      connection: { type: "http", endpoint: "https://box.e2b.app" },
    });
    await expect(
      launchMode(createHandle({ run: vi.fn() }), "web", { prompt: { kind: "initial", text: "no" } }),
    ).rejects.toThrow("not supported in web mode");
  });
});

function ok(stdout = ""): { stdout: string; stderr: string; exitCode: number } {
  return { stdout, stderr: "", exitCode: 0 };
}

function createHandle(overrides: Partial<SandboxHandle> = {}): SandboxHandle {
  return {
    sandboxId: "sbx-1",
    run: vi.fn().mockResolvedValue(ok()),
    writeFile: vi.fn().mockResolvedValue(undefined),
    getHost: vi.fn().mockResolvedValue("sbx.e2b.app"),
    setTimeout: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
