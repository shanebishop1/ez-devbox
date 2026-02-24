import { describe, expect, it, vi } from "vitest";
import { runResumeCommand } from "../src/cli/commands.resume.js";

describe("runResumeCommand", () => {
  it("reuses last sandbox id and mode through connect", async () => {
    const runConnectCommand = vi.fn().mockResolvedValue({
      message: "Connected to sandbox sbx-123.",
      exitCode: 0
    });

    const result = await runResumeCommand([], {
      loadLastRunState: vi.fn().mockResolvedValue({
        sandboxId: "sbx-123",
        mode: "ssh-codex",
        updatedAt: "2026-02-01T00:00:00.000Z"
      }),
      runConnectCommand
    });

    expect(runConnectCommand).toHaveBeenCalledWith(["--sandbox-id", "sbx-123", "--mode", "ssh-codex"]);
    expect(result).toEqual({
      message: "Connected to sandbox sbx-123.",
      exitCode: 0
    });
  });

  it("falls back prompt mode to ssh-opencode when resuming", async () => {
    const runConnectCommand = vi.fn().mockResolvedValue({ message: "ok", exitCode: 0 });

    await runResumeCommand([], {
      loadLastRunState: vi.fn().mockResolvedValue({
        sandboxId: "sbx-123",
        mode: "prompt",
        updatedAt: "2026-02-01T00:00:00.000Z"
      }),
      runConnectCommand
    });

    expect(runConnectCommand).toHaveBeenCalledWith(["--sandbox-id", "sbx-123", "--mode", "ssh-opencode"]);
  });

  it("errors when no prior run exists", async () => {
    await expect(
      runResumeCommand([], {
        loadLastRunState: vi.fn().mockResolvedValue(null),
        runConnectCommand: vi.fn()
      })
    ).rejects.toThrow("No last-run state found");
  });

  it("rejects unexpected args", async () => {
    await expect(
      runResumeCommand(["--mode", "ssh-opencode"], {
        loadLastRunState: vi.fn().mockResolvedValue(null),
        runConnectCommand: vi.fn()
      })
    ).rejects.toThrow("Unexpected arguments for resume");
  });
});
