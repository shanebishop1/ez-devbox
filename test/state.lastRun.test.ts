import { mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { clearLastRunState, loadLastRunState, saveLastRunState } from "../src/state/lastRun.js";

describe("last-run state persistence", () => {
  it("save/load/clear roundtrip", async () => {
    const directory = await mkdtemp(join(tmpdir(), "agent-box-last-run-"));
    const statePath = join(directory, "last-run.json");

    await saveLastRunState(
      {
        sandboxId: "sbx-123",
        mode: "web",
        activeRepo: "agent-box",
        updatedAt: "2026-01-01T00:00:00.000Z"
      },
      statePath
    );

    const loaded = await loadLastRunState(statePath);
    expect(loaded).toEqual({
      sandboxId: "sbx-123",
      mode: "web",
      activeRepo: "agent-box",
      updatedAt: "2026-01-01T00:00:00.000Z"
    });

    await clearLastRunState(statePath);
    await expect(stat(statePath)).rejects.toMatchObject({ code: "ENOENT" });
    await expect(loadLastRunState(statePath)).resolves.toBeNull();
  });

  it("falls back to legacy .agent-box-last-run.json when new default file is missing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ez-box-last-run-"));
    const newStatePath = join(directory, ".ez-box-last-run.json");
    const legacyStatePath = join(directory, ".agent-box-last-run.json");

    await writeFile(
      legacyStatePath,
      JSON.stringify(
        {
          sandboxId: "sbx-legacy",
          mode: "ssh-opencode",
          updatedAt: "2026-01-01T00:00:00.000Z"
        },
        null,
        2
      ),
      "utf8"
    );

    const loaded = await loadLastRunState(newStatePath);
    expect(loaded).toEqual({
      sandboxId: "sbx-legacy",
      mode: "ssh-opencode",
      updatedAt: "2026-01-01T00:00:00.000Z",
      activeRepo: undefined
    });
  });
});
