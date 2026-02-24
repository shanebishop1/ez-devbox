import { describe, expect, it, vi } from "vitest";
import { resolveHostGhToken } from "../src/auth/gh-host-token.js";

describe("resolveHostGhToken", () => {
  it("prefers GH_TOKEN over GITHUB_TOKEN and does not execute gh command", async () => {
    const execCommand = vi.fn();

    const token = await resolveHostGhToken(
      {
        GH_TOKEN: "  gh-token  ",
        GITHUB_TOKEN: "  github-token  "
      },
      { execCommand }
    );

    expect(token).toBe("gh-token");
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("uses GITHUB_TOKEN when GH_TOKEN is blank", async () => {
    const execCommand = vi.fn();

    const token = await resolveHostGhToken(
      {
        GH_TOKEN: "   ",
        GITHUB_TOKEN: "  github-token  "
      },
      { execCommand }
    );

    expect(token).toBe("github-token");
    expect(execCommand).not.toHaveBeenCalled();
  });

  it("falls back to gh auth token command and trims output", async () => {
    const execCommand = vi.fn().mockResolvedValue({ stdout: "  host-token\n" });

    const token = await resolveHostGhToken({}, { execCommand });

    expect(token).toBe("host-token");
    expect(execCommand).toHaveBeenCalledWith("gh", ["auth", "token"]);
  });

  it("returns undefined when gh auth token command fails", async () => {
    const execCommand = vi.fn().mockRejectedValue(new Error("not logged in"));

    const token = await resolveHostGhToken({}, { execCommand });

    expect(token).toBeUndefined();
  });

  it("returns undefined when gh auth token command output is empty", async () => {
    const execCommand = vi.fn().mockResolvedValue({ stdout: "   \n" });

    const token = await resolveHostGhToken({}, { execCommand });

    expect(token).toBeUndefined();
  });
});
