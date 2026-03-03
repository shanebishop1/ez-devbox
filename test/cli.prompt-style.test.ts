import { afterEach, describe, expect, it } from "vitest";
import { formatPromptChoice, formatPromptHeader } from "../src/cli/prompt-style.js";

describe("prompt style helpers", () => {
  const originalNoColor = process.env.NO_COLOR;
  const originalForceColor = process.env.FORCE_COLOR;

  afterEach(() => {
    if (originalNoColor === undefined) {
      delete process.env.NO_COLOR;
    } else {
      process.env.NO_COLOR = originalNoColor;
    }

    if (originalForceColor === undefined) {
      delete process.env.FORCE_COLOR;
    } else {
      process.env.FORCE_COLOR = originalForceColor;
    }
  });

  it("returns plain header text when color is disabled", () => {
    process.env.NO_COLOR = "1";
    const output = { isTTY: true } as NodeJS.WriteStream;
    expect(formatPromptHeader("ez-devbox", output)).toBe("ez-devbox");
  });

  it("returns colored header text when color is forced", () => {
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = "1";
    const output = { isTTY: false } as NodeJS.WriteStream;
    expect(formatPromptHeader("ez-devbox", output)).toContain("\u001b[38;5;208m");
  });

  it("colors odd/even prompt choices with different styles", () => {
    delete process.env.NO_COLOR;
    process.env.FORCE_COLOR = "1";
    const output = { isTTY: true } as NodeJS.WriteStream;

    expect(formatPromptChoice(1, "first", output)).toContain("\u001b[34m1");
    expect(formatPromptChoice(2, "second", output)).toContain("\u001b[32m2");
  });
});
