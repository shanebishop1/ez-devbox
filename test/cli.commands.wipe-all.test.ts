import { describe, expect, it, vi } from "vitest";
import { runWipeAllCommand } from "../src/cli/commands.wipe-all.js";

describe("runWipeAllCommand", () => {
  it("rejects unexpected arguments with help guidance", async () => {
    await expect(
      runWipeAllCommand(["--bad"], {
        listSandboxes: vi.fn().mockResolvedValue([]),
        killSandbox: vi.fn().mockResolvedValue(undefined),
        isInteractiveTerminal: () => false,
        promptInput: vi.fn().mockResolvedValue("yes"),
        loadLastRunState: vi.fn().mockResolvedValue(null),
        clearLastRunState: vi.fn().mockResolvedValue(undefined)
      })
    ).rejects.toThrow("Unknown option for wipe-all: '--bad'. Use --help for usage.");
  });

  it("deletes all sandboxes with --yes", async () => {
    const killSandbox = vi.fn().mockResolvedValue(undefined);

    const result = await runWipeAllCommand(["--yes"], {
      listSandboxes: vi.fn().mockResolvedValue([
        { sandboxId: "sbx-1", state: "running", metadata: { "launcher.name": "Alpha" } },
        { sandboxId: "sbx-2", state: "running", metadata: { "launcher.name": "Beta" } }
      ]),
      killSandbox,
      isInteractiveTerminal: () => false,
      promptInput: vi.fn().mockResolvedValue("yes"),
      loadLastRunState: vi.fn().mockResolvedValue(null),
      clearLastRunState: vi.fn().mockResolvedValue(undefined)
    });

    expect(killSandbox).toHaveBeenCalledTimes(2);
    expect(killSandbox).toHaveBeenNthCalledWith(1, "sbx-1");
    expect(killSandbox).toHaveBeenNthCalledWith(2, "sbx-2");
    expect(result.message).toBe("Wiped 2 sandboxes: Alpha (sbx-1), Beta (sbx-2).");
  });

  it("accepts interactive confirmation and wipes", async () => {
    const killSandbox = vi.fn().mockResolvedValue(undefined);
    const promptInput = vi.fn().mockResolvedValue("y");

    const result = await runWipeAllCommand([], {
      listSandboxes: vi.fn().mockResolvedValue([{ sandboxId: "sbx-1", state: "running", metadata: { "launcher.name": "Alpha" } }]),
      killSandbox,
      isInteractiveTerminal: () => true,
      promptInput,
      loadLastRunState: vi.fn().mockResolvedValue(null),
      clearLastRunState: vi.fn().mockResolvedValue(undefined)
    });

    expect(promptInput).toHaveBeenCalledWith("Delete 1 sandbox(s)? Type 'yes' or 'y' to confirm: ");
    expect(killSandbox).toHaveBeenCalledWith("sbx-1");
    expect(result.message).toBe("Wiped 1 sandbox: Alpha (sbx-1).");
  });

  it("rejects interactive confirmation and does not wipe", async () => {
    const killSandbox = vi.fn().mockResolvedValue(undefined);

    const result = await runWipeAllCommand([], {
      listSandboxes: vi.fn().mockResolvedValue([{ sandboxId: "sbx-1", state: "running" }]),
      killSandbox,
      isInteractiveTerminal: () => true,
      promptInput: vi.fn().mockResolvedValue("no"),
      loadLastRunState: vi.fn().mockResolvedValue(null),
      clearLastRunState: vi.fn().mockResolvedValue(undefined)
    });

    expect(killSandbox).not.toHaveBeenCalled();
    expect(result.message).toBe("Wipe-all cancelled.");
  });

  it("errors in non-interactive terminals without --yes", async () => {
    await expect(
      runWipeAllCommand([], {
        listSandboxes: vi.fn().mockResolvedValue([{ sandboxId: "sbx-1", state: "running" }]),
        killSandbox: vi.fn().mockResolvedValue(undefined),
        isInteractiveTerminal: () => false,
        promptInput: vi.fn().mockResolvedValue("yes"),
        loadLastRunState: vi.fn().mockResolvedValue(null),
        clearLastRunState: vi.fn().mockResolvedValue(undefined)
      })
    ).rejects.toThrow("wipe-all requires --yes in non-interactive terminals. Re-run with --yes.");
  });

  it("returns success when there are no sandboxes", async () => {
    const result = await runWipeAllCommand([], {
      listSandboxes: vi.fn().mockResolvedValue([]),
      killSandbox: vi.fn().mockResolvedValue(undefined),
      isInteractiveTerminal: () => false,
      promptInput: vi.fn().mockResolvedValue("yes"),
      loadLastRunState: vi.fn().mockResolvedValue(null),
      clearLastRunState: vi.fn().mockResolvedValue(undefined)
    });

    expect(result.message).toBe("No sandboxes found. Nothing to wipe.");
  });

  it("clears last-run state when deleted sandbox matches", async () => {
    const clearLastRunState = vi.fn().mockResolvedValue(undefined);

    await runWipeAllCommand(["--yes"], {
      listSandboxes: vi.fn().mockResolvedValue([{ sandboxId: "sbx-1", state: "running" }]),
      killSandbox: vi.fn().mockResolvedValue(undefined),
      isInteractiveTerminal: () => false,
      promptInput: vi.fn().mockResolvedValue("yes"),
      loadLastRunState: vi.fn().mockResolvedValue({ sandboxId: "sbx-1", mode: "web", updatedAt: "2026-01-01T00:00:00.000Z" }),
      clearLastRunState
    });

    expect(clearLastRunState).toHaveBeenCalledTimes(1);
  });

  it("continues deleting remaining sandboxes when one deletion fails", async () => {
    const killSandbox = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("api timeout"))
      .mockResolvedValueOnce(undefined);

    const result = await runWipeAllCommand(["--yes"], {
      listSandboxes: vi.fn().mockResolvedValue([
        { sandboxId: "sbx-1", state: "running", metadata: { "launcher.name": "Alpha" } },
        { sandboxId: "sbx-2", state: "running", metadata: { "launcher.name": "Beta" } },
        { sandboxId: "sbx-3", state: "running", metadata: { "launcher.name": "Gamma" } }
      ]),
      killSandbox,
      isInteractiveTerminal: () => false,
      promptInput: vi.fn().mockResolvedValue("yes"),
      loadLastRunState: vi.fn().mockResolvedValue(null),
      clearLastRunState: vi.fn().mockResolvedValue(undefined)
    });

    expect(killSandbox).toHaveBeenCalledTimes(3);
    expect(result.exitCode).toBe(1);
    expect(result.message).toContain("Wiped 2 sandboxes: Alpha (sbx-1), Gamma (sbx-3).");
    expect(result.message).toContain("Failed to wipe 1 sandbox: Beta (sbx-2) (api timeout).");
  });

  it("does not clear last-run state when matching sandbox delete fails", async () => {
    const clearLastRunState = vi.fn().mockResolvedValue(undefined);

    await runWipeAllCommand(["--yes"], {
      listSandboxes: vi.fn().mockResolvedValue([
        { sandboxId: "sbx-1", state: "running" },
        { sandboxId: "sbx-2", state: "running" }
      ]),
      killSandbox: vi
        .fn()
        .mockResolvedValueOnce(undefined)
        .mockRejectedValueOnce(new Error("permission denied")),
      isInteractiveTerminal: () => false,
      promptInput: vi.fn().mockResolvedValue("yes"),
      loadLastRunState: vi.fn().mockResolvedValue({ sandboxId: "sbx-2", mode: "web", updatedAt: "2026-01-01T00:00:00.000Z" }),
      clearLastRunState
    });

    expect(clearLastRunState).not.toHaveBeenCalled();
  });
});
