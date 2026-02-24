import { describe, expect, it } from "vitest";
import {
  buildSandboxDisplayName,
  formatSandboxDisplayLabel,
  resolveSandboxDisplayName
} from "../src/cli/sandbox-display-name.js";

describe("sandbox display naming", () => {
  it("builds deterministic readable names from base/mode/timestamp", () => {
    expect(buildSandboxDisplayName("agent-box", "ssh-codex", "2026-02-01T12:34:56.789Z")).toBe(
      "agent-box ssh codex 2026-02-01 12:34:56 UTC"
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
