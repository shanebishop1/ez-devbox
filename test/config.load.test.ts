import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig, loadConfigWithMetadata } from "../src/config/load.js";
import { defaultConfig } from "../src/config/defaults.js";

describe("loadConfig", () => {
  let tempDir = "";
  let originalE2bApiKey: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agent-box-config-"));
    originalE2bApiKey = process.env.E2B_API_KEY;
    delete process.env.E2B_API_KEY;
  });

  afterEach(async () => {
    if (originalE2bApiKey === undefined) {
      delete process.env.E2B_API_KEY;
    } else {
      process.env.E2B_API_KEY = originalE2bApiKey;
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
        'name = "ez-devbox"',
        'url = "https://github.com/shanebishop1/ez-devbox.git"'
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
    expect(resolved.project.working_dir).toBe("auto");
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
    expect(resolved.gh).toEqual({
      enabled: false,
      config_dir: "~/.config/gh"
    });
    expect(resolved.tunnel.ports).toEqual([]);
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

  it("supports gh sync config overrides", async () => {
    const configPath = join(tempDir, "launcher.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(
      configPath,
      ["[gh]", "enabled = true", 'config_dir = "/tmp/gh-config"'].join("\n")
    );
    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    const resolved = await loadConfig({ configPath, envPath });

    expect(resolved.gh).toEqual({
      enabled: true,
      config_dir: "/tmp/gh-config"
    });
  });

  it("rejects empty gh.config_dir", async () => {
    const configPath = join(tempDir, "launcher.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(configPath, ["[gh]", 'config_dir = ""'].join("\n"));
    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    await expect(loadConfig({ configPath, envPath })).rejects.toThrow("gh.config_dir");
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

  it("accepts project.working_dir path override", async () => {
    const configPath = join(tempDir, "launcher.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(
      configPath,
      ["[project]", 'working_dir = "./custom-cwd"'].join("\n")
    );
    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    const resolved = await loadConfig({ configPath, envPath });

    expect(resolved.project.working_dir).toBe("./custom-cwd");
  });

  it("rejects empty project.working_dir", async () => {
    const configPath = join(tempDir, "launcher.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(
      configPath,
      ["[project]", 'working_dir = ""'].join("\n")
    );
    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    await expect(loadConfig({ configPath, envPath })).rejects.toThrow(
      "project.working_dir"
    );
  });

  it("rejects missing E2B_API_KEY", async () => {
    const configPath = join(tempDir, "launcher.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(configPath, "[startup]\nmode = \"prompt\"\n");
    await writeFile(envPath, "FIRECRAWL_API_KEY=secret\n");

    await expect(loadConfig({ configPath, envPath })).rejects.toThrow(
      "E2B_API_KEY"
    );
  });

  it("accepts tunnel.ports override", async () => {
    const configPath = join(tempDir, "launcher.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(
      configPath,
      ["[tunnel]", "ports = [3002, 8080]"].join("\n")
    );
    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    const resolved = await loadConfig({ configPath, envPath });
    expect(resolved.tunnel.ports).toEqual([3002, 8080]);
  });

  it("rejects invalid tunnel.ports values", async () => {
    const configPath = join(tempDir, "launcher.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(configPath, ["[tunnel]", "ports = [70000]"].join("\n"));
    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    await expect(loadConfig({ configPath, envPath })).rejects.toThrow("tunnel.ports");
  });

  it("rejects duplicate tunnel.ports entries", async () => {
    const configPath = join(tempDir, "launcher.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(configPath, ["[tunnel]", "ports = [3002, 3002]"].join("\n"));
    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    await expect(loadConfig({ configPath, envPath })).rejects.toThrow("duplicate port");
  });

  it("prefers local launcher config over global", async () => {
    const localConfigPath = join(tempDir, "launcher.config.toml");
    const globalConfigRoot = join(tempDir, "xdg");
    const globalConfigPath = join(globalConfigRoot, "ez-devbox", "launcher.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(localConfigPath, "[sandbox]\nname = \"local\"\n");
    await mkdir(join(globalConfigRoot, "ez-devbox"), { recursive: true });
    await writeFile(globalConfigPath, "[sandbox]\nname = \"global\"\n");
    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    const loaded = await loadConfigWithMetadata({
      cwd: tempDir,
      envPath,
      env: { XDG_CONFIG_HOME: globalConfigRoot }
    });

    expect(loaded.scope).toBe("local");
    expect(loaded.configPath).toBe(localConfigPath);
    expect(loaded.config.sandbox.name).toBe("local");
  });

  it("falls back to global launcher config when local is missing", async () => {
    const globalConfigRoot = join(tempDir, "xdg");
    const globalConfigPath = join(globalConfigRoot, "ez-devbox", "launcher.config.toml");
    const envPath = join(tempDir, ".env");

    await mkdir(join(globalConfigRoot, "ez-devbox"), { recursive: true });
    await writeFile(globalConfigPath, "[sandbox]\nname = \"global\"\n");
    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    const loaded = await loadConfigWithMetadata({
      cwd: tempDir,
      envPath,
      env: { XDG_CONFIG_HOME: globalConfigRoot }
    });

    expect(loaded.scope).toBe("global");
    expect(loaded.configPath).toBe(globalConfigPath);
    expect(loaded.config.sandbox.name).toBe("global");
  });

  it("creates local launcher config from prompt choice", async () => {
    const envPath = join(tempDir, ".env");
    const localConfigPath = join(tempDir, "launcher.config.toml");

    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    const loaded = await loadConfigWithMetadata({
      cwd: tempDir,
      envPath,
      isInteractiveTerminal: () => true,
      promptInput: async () => "1",
      env: { XDG_CONFIG_HOME: join(tempDir, "xdg") }
    });

    expect(loaded.scope).toBe("local");
    expect(loaded.createdConfig).toBe(true);
    expect(loaded.configPath).toBe(localConfigPath);
    await expect(readFile(localConfigPath, "utf8")).resolves.toContain("[sandbox]");
    expect(loaded.config.startup.mode).toBe("prompt");
  });

  it("creates global launcher config from prompt choice", async () => {
    const envPath = join(tempDir, ".env");
    const globalConfigRoot = join(tempDir, "xdg");
    const globalConfigPath = join(globalConfigRoot, "ez-devbox", "launcher.config.toml");

    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    const loaded = await loadConfigWithMetadata({
      cwd: tempDir,
      envPath,
      isInteractiveTerminal: () => true,
      promptInput: async () => "2",
      env: { XDG_CONFIG_HOME: globalConfigRoot }
    });

    expect(loaded.scope).toBe("global");
    expect(loaded.createdConfig).toBe(true);
    expect(loaded.configPath).toBe(globalConfigPath);
    await expect(readFile(globalConfigPath, "utf8")).resolves.toContain("[sandbox]");
  });

  it("errors with both local and global paths in non-interactive mode", async () => {
    const envPath = join(tempDir, ".env");
    const globalConfigRoot = join(tempDir, "xdg");

    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    await expect(
      loadConfigWithMetadata({
        cwd: tempDir,
        envPath,
        isInteractiveTerminal: () => false,
        env: { XDG_CONFIG_HOME: globalConfigRoot }
      })
    ).rejects.toThrow(`Create one at '${join(tempDir, "launcher.config.toml")}' or '${join(globalConfigRoot, "ez-devbox", "launcher.config.toml")}'.`);
  });
});
