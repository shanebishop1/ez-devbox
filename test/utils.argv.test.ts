import { describe, expect, it } from "vitest";
import { isHelpFlag } from "../src/utils/argv.js";

describe("isHelpFlag", () => {
  it("returns true for supported help flags", () => {
    expect(isHelpFlag("--help")).toBe(true);
    expect(isHelpFlag("-h")).toBe(true);
    expect(isHelpFlag("help")).toBe(true);
  });

  it("returns false for non-help values", () => {
    expect(isHelpFlag("create")).toBe(false);
    expect(isHelpFlag("--hel")).toBe(false);
    expect(isHelpFlag(undefined)).toBe(false);
  });
});
