import { describe, expect, it } from "vitest";
import { parseGlobalCliOptions, renderHelp, resolveCliCommand } from "../src/cli/router.js";

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

  it("routes resume command", () => {
    const resolved = resolveCliCommand(["resume"]);

    expect(resolved.command).toBe("resume");
    expect(resolved.args).toEqual([]);
  });

  it("routes list command with passthrough args", () => {
    const resolved = resolveCliCommand(["list", "--verbose"]);

    expect(resolved.command).toBe("list");
    expect(resolved.args).toEqual(["--verbose"]);
  });

  it("extracts global --verbose before command routing", () => {
    const parsed = parseGlobalCliOptions(["--verbose", "connect", "--sandbox-id", "sbx-1"]);

    expect(parsed.verbose).toBe(true);
    expect(parsed.args).toEqual(["connect", "--sandbox-id", "sbx-1"]);
  });

  it("extracts global --verbose after -- for non-command commands", () => {
    const parsed = parseGlobalCliOptions(["create", "--", "--verbose"]);

    expect(parsed.verbose).toBe(true);
    expect(parsed.args).toEqual(["create", "--"]);
  });

  it("does not treat args after -- as global --verbose", () => {
    const parsed = parseGlobalCliOptions(["command", "--", "--verbose"]);

    expect(parsed.verbose).toBe(false);
    expect(parsed.args).toEqual(["command", "--", "--verbose"]);
  });

  it("routes command command with passthrough args", () => {
    const resolved = resolveCliCommand(["command", "--sandbox-id", "sbx-1", "--", "pwd"]);

    expect(resolved.command).toBe("command");
    expect(resolved.args).toEqual(["--sandbox-id", "sbx-1", "--", "pwd"]);
  });

  it("includes wipe in help text", () => {
    expect(renderHelp()).toContain("wipe     Delete a sandbox by prompt or --sandbox-id");
  });

  it("includes wipe-all in help text", () => {
    expect(renderHelp()).toContain("wipe-all Delete all sandboxes (use --yes to skip prompt)");
  });

  it("includes list in help text", () => {
    expect(renderHelp()).toContain("list     List available sandboxes");
  });

  it("includes command in help text", () => {
    expect(renderHelp()).toContain("command  Run a command in a selected sandbox");
  });

  it("includes resume in help text", () => {
    expect(renderHelp()).toContain("resume   Reconnect using the last saved sandbox/mode");
  });

  it("includes verbose in help text", () => {
    expect(renderHelp()).toContain("--verbose             Show detailed startup/provisioning logs");
  });

  it("includes yes-sync in help text", () => {
    expect(renderHelp()).toContain("--yes-sync            Skip create-time tooling sync confirmation prompt");
  });
});
