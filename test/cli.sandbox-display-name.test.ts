import { describe, expect, it } from "vitest";
import {
  buildSandboxDisplayName,
  formatSandboxDisplayLabel,
  resolveSandboxDisplayName
} from "../src/cli/sandbox-display-name.js";

describe("sandbox display naming", () => {
  it("builds <repo-name> <branch> <timestamp> when exactly one repo is configured", () => {
    expect(
      buildSandboxDisplayName(
        [
          {
            name: "next.js",
            url: "https://github.com/vercel/next.js.git",
            branch: "canary",
            setup_command: "",
            setup_env: {},
            startup_env: {}
          }
        ],
        "2026-02-01T12:34:56.789Z"
      )
    ).toBe("next.js canary 2026-02-01 12:34:56 UTC");
  });

  it("builds <timestamp> when no repos are configured", () => {
    expect(buildSandboxDisplayName([], "2026-02-01T12:34:56.789Z")).toBe("2026-02-01 12:34:56 UTC");
  });

  it("builds <timestamp> when multiple repos are configured", () => {
    expect(
      buildSandboxDisplayName(
        [
          {
            name: "next.js",
            url: "https://github.com/vercel/next.js.git",
            branch: "canary",
            setup_command: "",
            setup_env: {},
            startup_env: {}
          },
          {
            name: "react",
            url: "https://github.com/facebook/react.git",
            branch: "main",
            setup_command: "",
            setup_env: {},
            startup_env: {}
          }
        ],
        "2026-02-01T12:34:56.789Z"
      )
    ).toBe("2026-02-01 12:34:56 UTC");
  });

  it("falls back for blank timestamp", () => {
    expect(buildSandboxDisplayName([], "  ")).toBe("unknown-time");
    expect(
      buildSandboxDisplayName(
        [
          {
            name: "next.js",
            url: "https://github.com/vercel/next.js.git",
            branch: "canary",
            setup_command: "",
            setup_env: {},
            startup_env: {}
          }
        ],
        "  "
      )
    ).toBe("next.js canary unknown-time");
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
