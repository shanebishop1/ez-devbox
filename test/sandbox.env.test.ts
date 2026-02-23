import { describe, expect, it } from "vitest";
import { resolveSandboxCreateEnv } from "../src/e2b/env.js";
import type { ResolvedLauncherConfig } from "../src/config/schema.js";

describe("sandbox env resolution", () => {
  const baseConfig: ResolvedLauncherConfig = {
    sandbox: {
      template: "base",
      reuse: true,
      name: "agent-box",
      timeout_ms: 1_800_000,
      delete_on_exit: false
    },
    startup: {
      mode: "prompt"
    },
    project: {
      mode: "single",
      active: "prompt",
      dir: "/workspace",
      setup_on_connect: false,
      setup_retries: 2,
      setup_continue_on_error: false,
      repos: []
    },
    env: {
      pass_through: ["CUSTOM_TOKEN", "GITHUB_TOKEN"]
    },
    opencode: {
      config_dir: "~/.config/opencode",
      auth_path: "~/.local/share/opencode/auth.json"
    },
    codex: {
      config_dir: "~/.codex",
      auth_path: "~/.codex/auth.json"
    },
    mcp: {
      mode: "remote_url",
      firecrawl_api_url: "https://firecrawl.example.com",
      allow_localhost_override: false
    }
  };

  it("includes pass-through allowlist, built-ins, and firecrawl env", () => {
    const resolved = resolveSandboxCreateEnv(baseConfig, {
      CUSTOM_TOKEN: "abc",
      OPENAI_API_KEY: "openai-key",
      GITHUB_TOKEN: "ghp_123",
      OPENCODE_SERVER_PASSWORD: "pw",
      FIRECRAWL_API_KEY: "fc-key",
      UNUSED: "nope"
    });

    expect(resolved.envs).toEqual({
      CUSTOM_TOKEN: "abc",
      OPENAI_API_KEY: "openai-key",
      GITHUB_TOKEN: "ghp_123",
      OPENCODE_SERVER_PASSWORD: "pw",
      FIRECRAWL_API_URL: "https://firecrawl.example.com",
      FIRECRAWL_API_KEY: "fc-key"
    });
    expect(resolved.warnings).toEqual([]);
  });

  it("surfaces mcp warnings without leaking empty env entries", () => {
    const resolved = resolveSandboxCreateEnv(
      {
        ...baseConfig,
        mcp: {
          mode: "in_sandbox",
          firecrawl_api_url: "",
          allow_localhost_override: false
        }
      },
      {
        CUSTOM_TOKEN: "",
        OPENAI_API_KEY: "   "
      }
    );

    expect(resolved.envs).toEqual({});
    expect(resolved.warnings).toEqual([
      "mcp.mode='in_sandbox' is advanced and not fully implemented yet. Provide mcp.firecrawl_api_url or FIRECRAWL_API_URL to use a known remote endpoint."
    ]);
  });
});
