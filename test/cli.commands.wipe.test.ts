import { describe, expect, it, vi } from "vitest";
import { runWipeCommand } from "../src/cli/commands.wipe.js";

describe("runWipeCommand", () => {
  it("supports interactive numeric selection", async () => {
    const killSandbox = vi.fn().mockResolvedValue(undefined);
    const promptInput = vi.fn().mockResolvedValue("2");

    const result = await runWipeCommand([], {
      listSandboxes: vi.fn().mockResolvedValue([
        { sandboxId: "sbx-1", state: "running", metadata: { "launcher.name": "Alpha" } },
        { sandboxId: "sbx-2", state: "running", metadata: { "launcher.name": "Beta" } }
      ]),
      killSandbox,
      isInteractiveTerminal: () => true,
      promptInput,
      loadLastRunState: vi.fn().mockResolvedValue(null),
      clearLastRunState: vi.fn().mockResolvedValue(undefined)
    });

    expect(promptInput).toHaveBeenCalledWith(
      ["Select sandbox to wipe:", "1) Alpha (sbx-1)", "2) Beta (sbx-2)", "Enter choice number: "].join("\n")
    );
    expect(killSandbox).toHaveBeenCalledWith("sbx-2");
    expect(result.message).toBe("Wiped sandbox Beta (sbx-2).");
  });

  it("supports direct --sandbox-id path and clears matching last-run state", async () => {
    const promptInput = vi.fn().mockResolvedValue("1");
    const clearLastRunState = vi.fn().mockResolvedValue(undefined);
    const killSandbox = vi.fn().mockResolvedValue(undefined);

    const result = await runWipeCommand(["--sandbox-id", "sbx-1"], {
      listSandboxes: vi.fn().mockResolvedValue([{ sandboxId: "sbx-1", state: "running", metadata: { "launcher.name": "Alpha" } }]),
      killSandbox,
      isInteractiveTerminal: () => false,
      promptInput,
      loadLastRunState: vi.fn().mockResolvedValue({ sandboxId: "sbx-1", mode: "web", updatedAt: "2026-02-01T00:00:00.000Z" }),
      clearLastRunState
    });

    expect(promptInput).not.toHaveBeenCalled();
    expect(killSandbox).toHaveBeenCalledWith("sbx-1");
    expect(clearLastRunState).toHaveBeenCalledTimes(1);
    expect(result.message).toBe("Wiped sandbox Alpha (sbx-1).");
  });

  it("throws actionable error in non-interactive terminals without --sandbox-id", async () => {
    await expect(
      runWipeCommand([], {
        listSandboxes: vi.fn().mockResolvedValue([{ sandboxId: "sbx-1", state: "running" }]),
        killSandbox: vi.fn().mockResolvedValue(undefined),
        isInteractiveTerminal: () => false,
        promptInput: vi.fn().mockResolvedValue("1"),
        loadLastRunState: vi.fn().mockResolvedValue(null),
        clearLastRunState: vi.fn().mockResolvedValue(undefined)
      })
    ).rejects.toThrow("No --sandbox-id provided in a non-interactive terminal. Re-run with --sandbox-id <id>.");
  });

  it("rejects invalid selection with clear error", async () => {
    await expect(
      runWipeCommand([], {
        listSandboxes: vi.fn().mockResolvedValue([{ sandboxId: "sbx-1", state: "running" }]),
        killSandbox: vi.fn().mockResolvedValue(undefined),
        isInteractiveTerminal: () => true,
        promptInput: vi.fn().mockResolvedValue("9"),
        loadLastRunState: vi.fn().mockResolvedValue(null),
        clearLastRunState: vi.fn().mockResolvedValue(undefined)
      })
    ).rejects.toThrow("Invalid selection '9'. Enter a number between 1 and 1.");
  });
});
