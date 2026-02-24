import { createHash } from "node:crypto";
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

  it("defaults to an isolated path in the OS temp directory", async () => {
    const cwdHash = createHash("sha1").update(process.cwd()).digest("hex");
    const expectedStatePath = join(tmpdir(), "ez-devbox", "last-run", "cwd-state", cwdHash, ".ez-devbox-last-run.json");

    await clearLastRunState();
    await saveLastRunState({
      sandboxId: "sbx-temp",
      mode: "web",
      updatedAt: "2026-02-01T00:00:00.000Z"
    });

    const loaded = await loadLastRunState();
    expect(loaded).toEqual({
      sandboxId: "sbx-temp",
      mode: "web",
      updatedAt: "2026-02-01T00:00:00.000Z"
    });

    await expect(stat(expectedStatePath)).resolves.toBeTruthy();
    await clearLastRunState();
    await expect(stat(expectedStatePath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("falls back to legacy .agent-box-last-run.json when new default file is missing", async () => {
    const directory = await mkdtemp(join(tmpdir(), "ez-devbox-last-run-"));
    const newStatePath = join(directory, ".ez-devbox-last-run.json");
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
