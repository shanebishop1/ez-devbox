import { describe, expect, it } from "vitest";
import { renderHelp, resolveCliCommand } from "../src/cli/router.js";

describe("CLI bootstrap routing", () => {
  it("routes known command with passthrough args", () => {
    const resolved = resolveCliCommand(["create", "--name", "demo"]);

    expect(resolved.command).toBe("create");
    expect(resolved.args).toEqual(["--name", "demo"]);
  });

  it("routes wipe command with passthrough args", () => {
    const resolved = resolveCliCommand(["wipe", "--sandbox-id", "sbx-1"]);

    expect(resolved.command).toBe("wipe");
    expect(resolved.args).toEqual(["--sandbox-id", "sbx-1"]);
  });

  it("routes wipe-all command with passthrough args", () => {
    const resolved = resolveCliCommand(["wipe-all", "--yes"]);

    expect(resolved.command).toBe("wipe-all");
    expect(resolved.args).toEqual(["--yes"]);
  });

  it("includes wipe in help text", () => {
    expect(renderHelp()).toContain("wipe     Delete a sandbox by prompt or --sandbox-id");
  });

  it("includes wipe-all in help text", () => {
    expect(renderHelp()).toContain("wipe-all Delete all sandboxes (use --yes to skip prompt)");
  });
});
