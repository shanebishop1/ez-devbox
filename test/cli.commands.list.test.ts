import { describe, expect, it, vi } from "vitest";
import { runListCommand } from "../src/cli/commands.list.js";

describe("runListCommand", () => {
  it("rejects unexpected arguments with help guidance", async () => {
    await expect(
      runListCommand(["--bad"], {
        listSandboxes: vi.fn().mockResolvedValue([])
      })
    ).rejects.toThrow("Unknown option for list: '--bad'. Use --help for usage.");
  });

  it("formats numbered sandbox lines with labels and state", async () => {
    const result = await runListCommand([], {
      listSandboxes: vi.fn().mockResolvedValue([
        { sandboxId: "sbx-1", state: "running", metadata: { "launcher.name": "Alpha" } },
        { sandboxId: "sbx-2", state: "paused" }
      ])
    });

    expect(result.message).toBe(["1) Alpha (sbx-1) [running]", "2) sbx-2 [paused]"].join("\n"));
    expect(result.exitCode).toBe(0);
  });

  it("returns empty state message when no sandboxes exist", async () => {
    const result = await runListCommand([], {
      listSandboxes: vi.fn().mockResolvedValue([])
    });

    expect(result.message).toBe("No sandboxes found.");
    expect(result.exitCode).toBe(0);
  });
});
