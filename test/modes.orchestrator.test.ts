import { describe, expect, it, vi } from "vitest";
import { launchMode, type ModeLaunchResult } from "../src/modes/index.js";
import type { SandboxHandle } from "../src/e2b/lifecycle.js";

describe("startup modes orchestrator", () => {
  it("web mode starts serve in background, waits for readiness, and returns external https URL", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    const getHost = vi.fn().mockResolvedValue("sandbox-123.e2b.dev");
    const handle = createHandle({ run, getHost });

    const result = await launchMode(handle, "web");

    expect(run).toHaveBeenNthCalledWith(
      1,
      "nohup opencode serve --hostname 0.0.0.0 --port 3000 >/tmp/opencode-serve.log 2>&1 &",
      { timeoutMs: 10_000 }
    );
    expect(run).toHaveBeenNthCalledWith(
      2,
      "bash -lc 'for attempt in $(seq 1 30); do status=$(curl -s -o /dev/null -w \"%{http_code}\" http://127.0.0.1:3000/ || true); if [ \"$status\" = \"200\" ] || [ \"$status\" = \"401\" ]; then exit 0; fi; sleep 1; done; exit 1'",
      { timeoutMs: 35_000 }
    );
    expect(getHost).toHaveBeenCalledWith(3000);
    expect(result).toMatchObject<Partial<ModeLaunchResult>>({
      mode: "web",
      url: "https://sandbox-123.e2b.dev"
    });
  });

  it("prompt mode resolves deterministically to ssh-opencode smoke check", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "OpenCode 1.2.3\n", stderr: "", exitCode: 0 });
    const handle = createHandle({ run });

    const result = await launchMode(handle, "prompt");

    expect(run).toHaveBeenCalledWith("opencode --version", { timeoutMs: 15_000 });
    expect(result.mode).toBe("ssh-opencode");
    expect(result.command).toBe("opencode --version");
    expect(result.details).toEqual({
      smoke: "opencode-cli",
      status: "ready",
      output: "OpenCode 1.2.3"
    });
  });

  it("ssh-codex mode runs codex smoke check", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "codex 0.9.0\n", stderr: "", exitCode: 0 });
    const handle = createHandle({ run });

    const result = await launchMode(handle, "ssh-codex");

    expect(run).toHaveBeenCalledWith("codex --version", { timeoutMs: 15_000 });
    expect(result.mode).toBe("ssh-codex");
    expect(result.details).toEqual({
      smoke: "codex-cli",
      status: "ready",
      output: "codex 0.9.0"
    });
  });

  it("ssh-shell mode runs deterministic shell smoke command", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "shell-ready\n", stderr: "", exitCode: 0 });
    const handle = createHandle({ run });

    const result = await launchMode(handle, "ssh-shell");

    expect(run).toHaveBeenCalledWith("bash -lc 'echo shell-ready'", { timeoutMs: 15_000 });
    expect(result.mode).toBe("ssh-shell");
    expect(result.details).toEqual({
      smoke: "shell",
      status: "ready",
      output: "shell-ready"
    });
  });
});

function createHandle(overrides: Partial<SandboxHandle>): SandboxHandle {
  return {
    sandboxId: "sbx-1",
    run: overrides.run ?? vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    getHost: overrides.getHost ?? vi.fn().mockResolvedValue("https://sbx-1.e2b.dev"),
    setTimeout: overrides.setTimeout ?? vi.fn().mockResolvedValue(undefined),
    kill: overrides.kill ?? vi.fn().mockResolvedValue(undefined)
  };
}
