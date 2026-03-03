import { describe, expect, it } from "vitest";
import { toUserVisibleCliErrorMessage } from "../src/cli/error-message.js";

describe("toUserVisibleCliErrorMessage", () => {
  it("redacts secrets from error messages", () => {
    const message = toUserVisibleCliErrorMessage(new Error("failed with GH_TOKEN=abc and Bearer xyz"));
    expect(message).toContain("GH_TOKEN=[REDACTED]");
    expect(message).toContain("Bearer [REDACTED]");
  });

  it("returns fallback for non-error values", () => {
    expect(toUserVisibleCliErrorMessage("boom")).toBe("Unexpected CLI failure");
  });
});
