import { describe, expect, it } from "vitest";
import { resolveFirecrawlEnv, validateFirecrawlPreflight } from "../src/mcp/firecrawl.js";
import type { ResolvedLauncherConfig } from "../src/config/schema.js";

describe("mcp/firecrawl", () => {
  it("remote_url fails with localhost by default", () => {
    const config = createConfig({ mode: "remote_url", firecrawl_api_url: "http://localhost:3000" });

    expect(() => validateFirecrawlPreflight(config, {})).toThrow("allow_localhost_override=true");
  });

  it("remote_url passes with non-local URL and injects env vars", () => {
    const config = createConfig({ mode: "remote_url", firecrawl_api_url: "https://firecrawl.example.com" });

    expect(() => validateFirecrawlPreflight(config, { FIRECRAWL_API_KEY: "secret-key" })).not.toThrow();

    expect(resolveFirecrawlEnv(config, { FIRECRAWL_API_KEY: "secret-key" })).toEqual({
      envs: {
        FIRECRAWL_API_URL: "https://firecrawl.example.com",
        FIRECRAWL_API_KEY: "secret-key"
      },
      warnings: []
    });
  });

  it("remote_url with allow_localhost_override=true returns warning", () => {
    const config = createConfig({
      mode: "remote_url",
      firecrawl_api_url: "http://127.0.0.1:3002",
      allow_localhost_override: true
    });

    const resolved = resolveFirecrawlEnv(config, {});

    expect(resolved.envs).toEqual({ FIRECRAWL_API_URL: "http://127.0.0.1:3002" });
    expect(resolved.warnings).toEqual([
      "Using localhost Firecrawl URL for mcp.mode='remote_url' via allow_localhost_override=true; this is not reachable from remote E2B sandboxes unless you provide tunnel/routing."
    ]);
  });

  it("disabled mode returns no env and no error", () => {
    const config = createConfig({ mode: "disabled", firecrawl_api_url: "https://ignored.example.com" });

    expect(() => validateFirecrawlPreflight(config, {})).not.toThrow();
    expect(resolveFirecrawlEnv(config, { FIRECRAWL_API_KEY: "secret-key" })).toEqual({
      envs: {},
      warnings: []
    });
  });

  it("in_sandbox mode returns warning and does not hard fail", () => {
    const config = createConfig({ mode: "in_sandbox", firecrawl_api_url: "" });

    expect(() => validateFirecrawlPreflight(config, {})).not.toThrow();
    expect(resolveFirecrawlEnv(config, {})).toEqual({
      envs: {},
      warnings: [
        "mcp.mode='in_sandbox' is advanced and not fully implemented yet. Provide mcp.firecrawl_api_url or FIRECRAWL_API_URL to use a known remote endpoint."
      ]
    });
  });
});

function createConfig(mcp: Partial<ResolvedLauncherConfig["mcp"]>): ResolvedLauncherConfig {
  return {
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
      pass_through: []
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
      mode: mcp.mode ?? "disabled",
      firecrawl_api_url: mcp.firecrawl_api_url ?? "",
      allow_localhost_override: mcp.allow_localhost_override ?? false
    }
  };
}
