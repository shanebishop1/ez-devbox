import { describe, expect, it } from "vitest";
import {
  addWebServerPasswordForWebMode,
  formatSelectedReposSummary,
  formatSetupOutcomeSummary,
  parseStartupModeValue,
  removeOpenCodeServerPassword,
  resolveWebServerPassword,
} from "../src/cli/command-shared.js";

describe("cli command shared helpers", () => {
  it("parses supported startup mode values", () => {
    expect(parseStartupModeValue("prompt")).toBe("prompt");
    expect(parseStartupModeValue("web")).toBe("web");
    expect(parseStartupModeValue("ssh-claude")).toBe("ssh-claude");
  });

  it("rejects unsupported startup mode values", () => {
    expect(() => parseStartupModeValue("bad-mode")).toThrow("Invalid value for --mode");
    expect(() => parseStartupModeValue(undefined)).toThrow("Invalid value for --mode");
  });

  it("removes OPENCODE_SERVER_PASSWORD from env maps", () => {
    expect(removeOpenCodeServerPassword({ A: "1", OPENCODE_SERVER_PASSWORD: "secret" })).toEqual({ A: "1" });
  });

  it("resolves and applies OPENCODE_SERVER_PASSWORD only for web mode", () => {
    expect(resolveWebServerPassword({ OPENCODE_SERVER_PASSWORD: "  secret  " })).toBe("secret");
    expect(resolveWebServerPassword({ OPENCODE_SERVER_PASSWORD: "   " })).toBeUndefined();

    expect(addWebServerPasswordForWebMode({ A: "1" }, "web", "secret")).toEqual({
      A: "1",
      OPENCODE_SERVER_PASSWORD: "secret",
    });
    expect(addWebServerPasswordForWebMode({ A: "1" }, "ssh-opencode", "secret")).toEqual({
      A: "1",
    });
  });

  it("formats selected repo and setup summaries", () => {
    expect(formatSelectedReposSummary([])).toBe("none");
    expect(formatSelectedReposSummary(["alpha", "beta"])).toBe("alpha, beta");

    expect(formatSetupOutcomeSummary(null)).toBe("skipped");
    expect(
      formatSetupOutcomeSummary({ success: true, repos: [{ repo: "alpha", path: "/x", success: true, steps: [] }] }),
    ).toBe("ran success=true repos=1");
  });
});
