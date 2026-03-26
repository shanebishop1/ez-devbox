import { describe, expect, it, vi } from "vitest";
import { runListCommand } from "../src/cli/commands.list.js";

describe("runListCommand", () => {
  it("applies E2B_API_KEY from resolved env source when process env is missing", async () => {
    const original = process.env.E2B_API_KEY;
    delete process.env.E2B_API_KEY;

    try {
      const listSandboxes = vi.fn().mockImplementation(async () => {
        expect(process.env.E2B_API_KEY).toBe("from-dotenv");
        return [];
      });

      await runListCommand([], {
        listSandboxes,
        resolveEnvSource: vi.fn().mockResolvedValue({
          E2B_API_KEY: "from-dotenv",
        }),
      });

      expect(listSandboxes).toHaveBeenCalledTimes(1);
    } finally {
      if (original === undefined) {
        delete process.env.E2B_API_KEY;
      } else {
        process.env.E2B_API_KEY = original;
      }
    }
  });

  it("does not override E2B_API_KEY already present in process env", async () => {
    const original = process.env.E2B_API_KEY;
    process.env.E2B_API_KEY = "from-process";

    try {
      const listSandboxes = vi.fn().mockImplementation(async () => {
        expect(process.env.E2B_API_KEY).toBe("from-process");
        return [];
      });

      await runListCommand([], {
        listSandboxes,
        resolveEnvSource: vi.fn().mockResolvedValue({
          E2B_API_KEY: "from-dotenv",
        }),
      });

      expect(listSandboxes).toHaveBeenCalledTimes(1);
    } finally {
      if (original === undefined) {
        delete process.env.E2B_API_KEY;
      } else {
        process.env.E2B_API_KEY = original;
      }
    }
  });

  it("rejects unexpected arguments with help guidance", async () => {
    await expect(
      runListCommand(["--bad"], {
        listSandboxes: vi.fn().mockResolvedValue([]),
      }),
    ).rejects.toThrow("Unknown option for list: '--bad'. Use --help for usage.");
  });

  it("formats numbered sandbox lines with labels and state", async () => {
    const result = await runListCommand([], {
      listSandboxes: vi.fn().mockResolvedValue([
        { sandboxId: "sbx-1", state: "running", metadata: { "launcher.name": "Alpha" } },
        { sandboxId: "sbx-2", state: "paused" },
      ]),
    });

    expect(result.message).toBe(
      ["SANDBOXES", "---------", "1) Alpha (sbx-1) [running]", "2) sbx-2 [paused]"].join("\n"),
    );
    expect(result.exitCode).toBe(0);
  });

  it("returns empty state message when no sandboxes exist", async () => {
    const result = await runListCommand([], {
      listSandboxes: vi.fn().mockResolvedValue([]),
    });

    expect(result.message).toBe("No sandboxes found.");
    expect(result.exitCode).toBe(0);
  });

  it("returns structured json output with --json", async () => {
    const result = await runListCommand(["--json"], {
      listSandboxes: vi
        .fn()
        .mockResolvedValue([{ sandboxId: "sbx-1", state: "running", metadata: { "launcher.name": "Alpha" } }]),
    });

    expect(result.message).toBe(
      JSON.stringify(
        {
          sandboxes: [
            {
              sandboxId: "sbx-1",
              label: "Alpha (sbx-1)",
              state: "running",
              metadata: { "launcher.name": "Alpha" },
            },
          ],
        },
        null,
        2,
      ),
    );
    expect(result.exitCode).toBe(0);
  });
});
