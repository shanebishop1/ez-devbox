import { describe, expect, it, vi } from "vitest";
import { resolveGitToken } from "../src/auth/token.js";

describe("resolveGitToken", () => {
  it("prefers GITHUB_TOKEN over GH_TOKEN and trims whitespace", async () => {
    const result = await resolveGitToken({
      GITHUB_TOKEN: "  github-token  ",
      GH_TOKEN: "  gh-token  "
    });

    expect(result).toEqual({
      token: "github-token",
      source: "env_github"
    });
  });

  it("uses GH_TOKEN when GITHUB_TOKEN is empty after trimming", async () => {
    const result = await resolveGitToken({
      GITHUB_TOKEN: "   ",
      GH_TOKEN: "  gh-token  "
    });

    expect(result).toEqual({
      token: "gh-token",
      source: "env_gh"
    });
  });

  it("falls back to host token resolver when env tokens are missing", async () => {
    const resolveHostToken = vi.fn().mockResolvedValue("  host-token  ");

    const result = await resolveGitToken({}, { resolveHostToken });

    expect(result).toEqual({
      token: "host-token",
      source: "host"
    });
    expect(resolveHostToken).toHaveBeenCalledWith({});
  });
});
