import { describe, expect, it, vi } from "vitest";
import {
  applyGitIdentity,
  getDefaultGitIdentity,
  resolveGitIdentity,
  type GitConfigExecutor
} from "../src/auth/gitIdentity.js";

describe("resolveGitIdentity", () => {
  it("uses env first, then fallback providers, then defaults", async () => {
    const fallback = vi
      .fn()
      .mockResolvedValue({
        name: "Fallback Name",
        email: "fallback@example.com"
      });

    const identity = await resolveGitIdentity(
      {
        GIT_AUTHOR_NAME: "  Env Name  "
      },
      {
        fallbackProviders: [fallback],
        defaultIdentity: {
          name: "Default Name",
          email: "default@example.local"
        }
      }
    );

    expect(identity).toEqual({
      name: "Env Name",
      email: "fallback@example.com"
    });
  });

  it("throws actionable error for invalid explicit env email", async () => {
    await expect(
      resolveGitIdentity({
        GIT_AUTHOR_EMAIL: "not-an-email"
      })
    ).rejects.toThrow("GIT_AUTHOR_EMAIL");
  });
});

describe("applyGitIdentity", () => {
  it("writes user.name and user.email via executor", async () => {
    const executor: GitConfigExecutor = {
      run: vi.fn().mockResolvedValue(undefined)
    };

    await applyGitIdentity(
      {
        name: "Example User",
        email: "user@example.com"
      },
      executor,
      { cwd: "/workspace/repo-a" }
    );

    expect(executor.run).toHaveBeenNthCalledWith(
      1,
      "git",
      ["config", "user.name", "Example User"],
      { cwd: "/workspace/repo-a" }
    );
    expect(executor.run).toHaveBeenNthCalledWith(
      2,
      "git",
      ["config", "user.email", "user@example.com"],
      { cwd: "/workspace/repo-a" }
    );
  });

  it("keeps existing default identity shape", () => {
    expect(getDefaultGitIdentity()).toEqual({
      name: "E2B Launcher",
      email: "launcher@example.local"
    });
  });
});
