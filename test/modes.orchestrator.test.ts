import { describe, expect, it, vi } from "vitest";
import { launchMode, type ModeLaunchResult } from "../src/modes/index.js";
import type { SandboxHandle } from "../src/e2b/lifecycle.js";

describe("startup modes orchestrator", () => {
  it("web mode runs serve command and returns external https URL", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    const getHost = vi.fn().mockResolvedValue("sandbox-123.e2b.dev");
    const handle = createHandle({ run, getHost });

    const result = await launchMode(handle, "web");

    expect(run).toHaveBeenCalledWith("opencode serve --hostname 0.0.0.0 --port 3000");
    expect(getHost).toHaveBeenCalledWith(3000);
    expect(result).toMatchObject<Partial<ModeLaunchResult>>({
      mode: "web",
      url: "https://sandbox-123.e2b.dev"
    });
  });

  it("prompt mode resolves deterministically to ssh-opencode", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    const handle = createHandle({ run });

    const result = await launchMode(handle, "prompt");

    expect(run).toHaveBeenCalledWith("opencode");
    expect(result.mode).toBe("ssh-opencode");
    expect(result.command).toBe("opencode");
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
