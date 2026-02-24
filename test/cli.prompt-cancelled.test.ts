import { describe, expect, it } from "vitest";
import {
  PromptCancelledError,
  isPromptCancelledError,
  normalizePromptCancelledError
} from "../src/cli/prompt-cancelled.js";

describe("prompt cancellation helper", () => {
  it("normalizes readline abort errors into PromptCancelledError", () => {
    const normalized = normalizePromptCancelledError({ name: "AbortError", code: "ABORT_ERR", message: "The operation was aborted" });

    expect(normalized).toBeInstanceOf(PromptCancelledError);
    expect(normalized?.message).toBe("Prompt cancelled.");
  });

  it("does not normalize non-cancellation errors", () => {
    const normalized = normalizePromptCancelledError(new Error("boom"));

    expect(normalized).toBeUndefined();
  });

  it("detects PromptCancelledError via guard", () => {
    expect(isPromptCancelledError(new PromptCancelledError("cancelled"))).toBe(true);
    expect(isPromptCancelledError(new Error("cancelled"))).toBe(false);
  });
});
