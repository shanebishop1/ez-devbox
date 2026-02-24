import { describe, expect, it } from "vitest";
import type { ResolvedProjectRepoConfig } from "../src/config/schema.js";
import {
  buildSandboxDisplayName,
  formatSandboxDisplayLabel,
  resolveSandboxDisplayName
} from "../src/cli/sandbox-display-name.js";

describe("sandbox display naming", () => {
  const repo = (name: string, branch: string): ResolvedProjectRepoConfig => ({
    name,
    branch,
    url: `https://example.com/${name}.git`,
    setup_pre_command: "",
    setup_command: "",
    setup_wrapper_command: "",
    setup_env: {},
    startup_env: {}
  });

  it("builds <repo> <branch> <timestamp> when exactly one repo is configured", () => {
    expect(buildSandboxDisplayName([repo("next.js", "canary")], "2026-02-01T12:34:56.789Z")).toBe(
      "next.js canary 2026-02-01 12:34:56 UTC"
    );
  });

  it("uses timestamp only when repo count is not one", () => {
    expect(buildSandboxDisplayName([], "2026-02-01T12:34:56.789Z")).toBe("2026-02-01 12:34:56 UTC");
    expect(buildSandboxDisplayName([repo("next.js", "canary"), repo("react", "main")], "2026-02-01T12:34:56.789Z")).toBe(
      "2026-02-01 12:34:56 UTC"
    );
  });

  it("resolves display name from metadata and falls back to sandbox id", () => {
    expect(resolveSandboxDisplayName({ "launcher.name": "Agent Box Web" }, "sbx-123")).toBe("Agent Box Web");
    expect(resolveSandboxDisplayName(undefined, "sbx-123")).toBe("sbx-123");
    expect(resolveSandboxDisplayName({ "launcher.name": "  " }, "sbx-123")).toBe("sbx-123");
  });

  it("formats label as <name> (<id>) when metadata name exists", () => {
    expect(formatSandboxDisplayLabel("sbx-123", { "launcher.name": "Agent Box Web" })).toBe("Agent Box Web (sbx-123)");
    expect(formatSandboxDisplayLabel("sbx-123", { "launcher.name": "   " })).toBe("sbx-123");
    expect(formatSandboxDisplayLabel("sbx-123")).toBe("sbx-123");
  });
});
