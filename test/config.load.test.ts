import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config/load.js";
import { defaultConfig } from "../src/config/defaults.js";

describe("loadConfig", () => {
  let tempDir = "";
  let originalE2bApiKey: string | undefined;
  let originalFirecrawlApiUrl: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agent-box-config-"));
    originalE2bApiKey = process.env.E2B_API_KEY;
    originalFirecrawlApiUrl = process.env.FIRECRAWL_API_URL;
    delete process.env.E2B_API_KEY;
    delete process.env.FIRECRAWL_API_URL;
  });

  afterEach(async () => {
    if (originalE2bApiKey === undefined) {
      delete process.env.E2B_API_KEY;
    } else {
      process.env.E2B_API_KEY = originalE2bApiKey;
    }

    if (originalFirecrawlApiUrl === undefined) {
      delete process.env.FIRECRAWL_API_URL;
    } else {
      process.env.FIRECRAWL_API_URL = originalFirecrawlApiUrl;
    }

    await rm(tempDir, { recursive: true, force: true });
  });

  it("loads valid config and applies defaults", async () => {
    const configPath = join(tempDir, "launcher.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(
      configPath,
      [
        "[sandbox]",
        'name = "team-box"',
        "",
        "[startup]",
        'mode = "web"',
        "",
        "[project]",
        'mode = "single"',
        'active = "prompt"',
        "",
        "[[project.repos]]",
        'name = "agent-box"',
        'url = "https://github.com/example/agent-box.git"'
      ].join("\n")
    );

    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    const resolved = await loadConfig({ configPath, envPath });

    expect(resolved.sandbox.template).toBe(defaultConfig.sandbox.template);
    expect(resolved.sandbox.reuse).toBe(true);
    expect(resolved.sandbox.name).toBe("team-box");
    expect(resolved.sandbox.timeout_ms).toBe(defaultConfig.sandbox.timeout_ms);
    expect(resolved.sandbox.delete_on_exit).toBe(false);

    expect(resolved.startup.mode).toBe("web");
    expect(resolved.project.dir).toBe("/home/user/projects/workspace");
    expect(resolved.project.setup_on_connect).toBe(false);
    expect(resolved.project.setup_retries).toBe(2);
    expect(resolved.project.setup_continue_on_error).toBe(false);
    expect(resolved.project.repos).toHaveLength(1);
    expect(resolved.project.repos[0].branch).toBe("main");
    expect(resolved.project.repos[0].setup_env).toEqual({});
    expect(resolved.project.repos[0].startup_env).toEqual({});

    expect(resolved.env.pass_through).toEqual([]);
    expect(resolved.opencode).toEqual({
      config_dir: "~/.config/opencode",
      auth_path: "~/.local/share/opencode/auth.json"
    });
    expect(resolved.codex).toEqual({
      config_dir: "~/.codex",
      auth_path: "~/.codex/auth.json"
    });
    expect(resolved.mcp.mode).toBe("disabled");
    expect(resolved.mcp.allow_localhost_override).toBe(false);
  });

  it("supports opencode/codex path overrides", async () => {
    const configPath = join(tempDir, "launcher.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(
      configPath,
      [
        "[opencode]",
        'config_dir = "/tmp/opencode-config"',
        'auth_path = "/tmp/opencode-auth.json"',
        "",
        "[codex]",
        'config_dir = "/tmp/codex-config"',
        'auth_path = "/tmp/codex-auth.json"'
      ].join("\n")
    );
    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    const resolved = await loadConfig({ configPath, envPath });

    expect(resolved.opencode).toEqual({
      config_dir: "/tmp/opencode-config",
      auth_path: "/tmp/opencode-auth.json"
    });
    expect(resolved.codex).toEqual({
      config_dir: "/tmp/codex-config",
      auth_path: "/tmp/codex-auth.json"
    });
  });

  it("rejects invalid startup mode", async () => {
    const configPath = join(tempDir, "launcher.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(
      configPath,
      ["[startup]", 'mode = "bad-mode"'].join("\n")
    );
    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    await expect(loadConfig({ configPath, envPath })).rejects.toThrow(
      "startup.mode"
    );
  });

  it("rejects missing E2B_API_KEY", async () => {
    const configPath = join(tempDir, "launcher.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(configPath, "[startup]\nmode = \"prompt\"\n");
    await writeFile(envPath, "FIRECRAWL_API_URL=https://api.example.com\n");

    await expect(loadConfig({ configPath, envPath })).rejects.toThrow(
      "E2B_API_KEY"
    );
  });

  it("validates mcp.remote_url requires firecrawl_api_url", async () => {
    const configPath = join(tempDir, "launcher.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(
      configPath,
      ["[mcp]", 'mode = "remote_url"'].join("\n")
    );
    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    await expect(loadConfig({ configPath, envPath })).rejects.toThrow(
      "mcp.firecrawl_api_url"
    );
  });
});
