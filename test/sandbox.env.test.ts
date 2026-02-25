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
      working_dir: "auto",
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
    gh: {
      enabled: false,
      config_dir: "~/.config/gh"
    },
    tunnel: {
      ports: []
    }
  };

  it("includes pass-through allowlist and built-ins", () => {
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
      GITHUB_TOKEN: "ghp_123"
    });
  });

  it("allows custom passthrough keys from config", () => {
    const resolved = resolveSandboxCreateEnv(
      {
        ...baseConfig,
        env: {
          pass_through: [...baseConfig.env.pass_through, "FIRECRAWL_API_KEY", "FIRECRAWL_API_URL"]
        }
      },
      {
        FIRECRAWL_API_KEY: "fc-key",
        FIRECRAWL_API_URL: "https://api.firecrawl.dev"
      }
    );

    expect(resolved.envs).toEqual({
      FIRECRAWL_API_KEY: "fc-key",
      FIRECRAWL_API_URL: "https://api.firecrawl.dev"
    });
  });

  it("skips empty values from env source", () => {
    const resolved = resolveSandboxCreateEnv(baseConfig, {
      CUSTOM_TOKEN: "",
      OPENAI_API_KEY: "   "
    });

    expect(resolved.envs).toEqual({});
  });
});
