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
    const run = vi
      .fn()
      .mockResolvedValueOnce(ok("ez-devbox-web:started:1234"))
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(ok("401"));
    const result = await launchMode(createHandle({ run, getHost: vi.fn().mockResolvedValue("box.e2b.app") }), "web");
    expect(result).toMatchObject({
      readiness: "ready",
      attachment: "not-applicable",
      connection: { type: "http", endpoint: "https://box.e2b.app" },
    });
    expect(result.command).toContain("opencode serve --hostname 0.0.0.0 --port 3000");
    await expect(
      launchMode(createHandle({ run: vi.fn() }), "web", { prompt: { kind: "initial", text: "no" } }),
    ).rejects.toThrow("not supported in web mode");
  });

  it("web mode refuses to launch without an effective sandbox password", async () => {
    const run = vi.fn().mockResolvedValueOnce(ok("ez-devbox-web:password-required"));

    await expect(launchMode(createHandle({ run }), "web")).rejects.toThrow(
      "requires a nonempty OPENCODE_SERVER_PASSWORD",
    );
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("web mode passes configured startup password without putting it in commands", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(ok("ez-devbox-web:started:1234"))
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(ok("401"));
    const password = "configured-password";

    await launchMode(createHandle({ run }), "web", { startupEnv: { OPENCODE_SERVER_PASSWORD: password } });

    expect(run.mock.calls.every(([command]) => !String(command).includes(password))).toBe(true);
    expect(run.mock.calls[0]?.[1]).toMatchObject({ envs: { OPENCODE_SERVER_PASSWORD: password } });
    expect(run.mock.calls[1]?.[1]).toMatchObject({ envs: { OPENCODE_SERVER_PASSWORD: password } });
  });

  it("web mode accepts a nonempty password inherited by the sandbox", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(ok("ez-devbox-web:started:1234"))
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(ok("401"));

    await launchMode(createHandle({ run }), "web");

    expect(run.mock.calls[0]?.[1]?.envs).not.toHaveProperty("OPENCODE_SERVER_PASSWORD");
  });

  it("web mode reuses an existing authenticated listener without checking host password", async () => {
    const run = vi.fn().mockResolvedValueOnce(ok("ez-devbox-web:existing-authenticated"));
    const handle = createHandle({ run });

    const result = await launchMode(handle, "web");

    expect(result.details).toMatchObject({ authRequired: true, authStatus: 401 });
    expect(run).toHaveBeenCalledTimes(1);
    expect(handle.getHost).toHaveBeenCalledWith(3000);
  });

  it("web mode refuses an existing unauthenticated listener without stopping it", async () => {
    const run = vi.fn().mockResolvedValueOnce(ok("ez-devbox-web:existing-unsafe:200"));

    await expect(launchMode(createHandle({ run }), "web")).rejects.toThrow("Refusing to reuse or stop it");
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("web mode cleans up only its owned listener after readiness failure", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(ok("ez-devbox-web:started:4321"))
      .mockResolvedValueOnce({ stdout: "", stderr: "not ready", exitCode: 1 })
      .mockResolvedValueOnce(ok("ez-devbox-web-cleanup:stopped"));

    await expect(launchMode(createHandle({ run }), "web")).rejects.toThrow("readiness check");
    const cleanupCommand = String(run.mock.calls[2]?.[0]);
    expect(cleanupCommand).toContain("/proc/$pid/environ");
    expect(cleanupCommand).toContain("'4321'");
    expect(cleanupCommand).toContain("EZ_DEVBOX_WEB_OWNER");
    expect(cleanupCommand).not.toContain("cmdline");
    expect(cleanupCommand).not.toContain("pkill");
  });

  it("web mode cleans up its owned listener after authentication verification failure", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(ok("ez-devbox-web:started:9876"))
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(ok("200"))
      .mockResolvedValueOnce(ok("ez-devbox-web-cleanup:stopped"));

    await expect(launchMode(createHandle({ run }), "web")).rejects.toThrow(
      "did not become password-protected. Set OPENCODE_SERVER_PASSWORD and retry. The listener process owned by this invocation was stopped.",
    );
    const cleanupCommand = String(run.mock.calls[3]?.[0]);
    expect(cleanupCommand).toContain("'9876'");
    expect(cleanupCommand).toContain("EZ_DEVBOX_WEB_OWNER");
    expect(cleanupCommand).not.toContain("pkill");
  });

  it("web mode awaits host resolution and cleans up its owned listener if it fails", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(ok("ez-devbox-web:started:2468"))
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(ok("401"))
      .mockResolvedValueOnce(ok("ez-devbox-web-cleanup:stopped"));
    const getHost = vi.fn().mockRejectedValue(new Error("host unavailable"));

    await expect(launchMode(createHandle({ run, getHost }), "web")).rejects.toThrow(
      "host unavailable. The listener process owned by this invocation was stopped.",
    );
    expect(run).toHaveBeenCalledTimes(4);
  });

  it("web mode reports when cleanup cannot verify ownership instead of claiming the listener stopped", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(ok("ez-devbox-web:started:1357"))
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(ok("200"))
      .mockResolvedValueOnce(ok("ez-devbox-web-cleanup:not-owned"));

    await expect(launchMode(createHandle({ run }), "web")).rejects.toThrow(
      "Cleanup refused to stop the process because ownership could not be verified",
    );
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
