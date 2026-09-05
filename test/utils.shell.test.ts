import { describe, expect, it } from "vitest";
import { buildArgvCommand } from "../src/utils/shell.js";

describe("remote argv quoting", () => {
  it("preserves argument boundaries and prevents shell interpolation", () => {
    expect(buildArgvCommand(["printf", "%s\\n", "a b", "$HOME", "x'y"])).toBe(`printf '%s\\n' 'a b' '$HOME' 'x'"'"'y'`);
  });
});
