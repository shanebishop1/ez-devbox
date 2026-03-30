import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defaultConfig } from "../src/config/defaults.js";
import { loadConfig, loadConfigWithMetadata } from "../src/config/load.js";

describe("loadConfig", () => {
  let tempDir = "";
  let originalE2bApiKey: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "ez-devbox-config-"));
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
    const configPath = join(tempDir, "ez-devbox.config.toml");
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
        'url = "https://github.com/shanebishop1/ez-devbox.git"',
      ].join("\n"),
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
    expect(resolved.project.setup_concurrency).toBe(1);
    expect(resolved.project.setup_continue_on_error).toBe(false);
    expect(resolved.project.repos).toHaveLength(1);
    expect(resolved.project.repos[0].branch).toBe("main");
    expect(resolved.project.repos[0].setup_env).toEqual({});
    expect(resolved.project.repos[0].startup_env).toEqual({});

    expect(resolved.env.pass_through).toEqual([]);
    expect(resolved.opencode).toEqual({
      config_dir: "~/.config/opencode",
      auth_path: "~/.local/share/opencode/auth.json",
    });
    expect(resolved.codex).toEqual({
      config_dir: "~/.codex",
      auth_path: "~/.codex/auth.json",
    });
    expect(resolved.claude).toEqual({
      config_dir: "~/.claude",
      state_path: "~/.claude.json",
    });
    expect(resolved.gh).toEqual({
      enabled: false,
      config_dir: "~/.config/gh",
    });
    expect(resolved.tunnel.ports).toEqual([]);
  });

  it("supports opencode/codex/claude path overrides", async () => {
    const configPath = join(tempDir, "ez-devbox.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(
      configPath,
      [
        "[opencode]",
        'config_dir = "/tmp/opencode-config"',
        'auth_path = "/tmp/opencode-auth.json"',
        "match_local_version = false",
        "",
        "[codex]",
        'config_dir = "/tmp/codex-config"',
        'auth_path = "/tmp/codex-auth.json"',
        "",
        "[claude]",
        'config_dir = "/tmp/claude-config"',
        'state_path = "/tmp/claude-state.json"',
      ].join("\n"),
    );
    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    const resolved = await loadConfig({ configPath, envPath });

    expect(resolved.opencode).toEqual({
      config_dir: "/tmp/opencode-config",
      auth_path: "/tmp/opencode-auth.json",
      match_local_version: false,
    });
    expect(resolved.codex).toEqual({
      config_dir: "/tmp/codex-config",
      auth_path: "/tmp/codex-auth.json",
    });
    expect(resolved.claude).toEqual({
      config_dir: "/tmp/claude-config",
      state_path: "/tmp/claude-state.json",
    });
  });

  it("supports gh sync config overrides", async () => {
    const configPath = join(tempDir, "ez-devbox.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(configPath, ["[gh]", "enabled = true", 'config_dir = "/tmp/gh-config"'].join("\n"));
    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    const resolved = await loadConfig({ configPath, envPath });

    expect(resolved.gh).toEqual({
      enabled: true,
      config_dir: "/tmp/gh-config",
    });
  });

  it("rejects empty gh.config_dir", async () => {
    const configPath = join(tempDir, "ez-devbox.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(configPath, ["[gh]", 'config_dir = ""'].join("\n"));
    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    await expect(loadConfig({ configPath, envPath })).rejects.toThrow("gh.config_dir");
  });

  it("rejects invalid startup mode", async () => {
    const configPath = join(tempDir, "ez-devbox.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(configPath, ["[startup]", 'mode = "bad-mode"'].join("\n"));
    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    await expect(loadConfig({ configPath, envPath })).rejects.toThrow("startup.mode");
  });

  it("accepts project.working_dir path override", async () => {
    const configPath = join(tempDir, "ez-devbox.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(configPath, ["[project]", 'working_dir = "./custom-cwd"'].join("\n"));
    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    const resolved = await loadConfig({ configPath, envPath });

    expect(resolved.project.working_dir).toBe("./custom-cwd");
  });

  it("rejects empty project.working_dir", async () => {
    const configPath = join(tempDir, "ez-devbox.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(configPath, ["[project]", 'working_dir = ""'].join("\n"));
    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    await expect(loadConfig({ configPath, envPath })).rejects.toThrow("project.working_dir");
  });

  it("accepts project.setup_concurrency override", async () => {
    const configPath = join(tempDir, "ez-devbox.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(configPath, ["[project]", "setup_concurrency = 3"].join("\n"));
    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    const resolved = await loadConfig({ configPath, envPath });
    expect(resolved.project.setup_concurrency).toBe(3);
  });

  it("rejects invalid project.setup_concurrency", async () => {
    const configPath = join(tempDir, "ez-devbox.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(configPath, ["[project]", "setup_concurrency = 0"].join("\n"));
    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    await expect(loadConfig({ configPath, envPath })).rejects.toThrow("project.setup_concurrency");
  });

  it("rejects missing E2B_API_KEY", async () => {
    const configPath = join(tempDir, "ez-devbox.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(configPath, '[startup]\nmode = "prompt"\n');
    await writeFile(envPath, "FIRECRAWL_API_KEY=secret\n");

    await expect(loadConfig({ configPath, envPath })).rejects.toThrow("E2B_API_KEY");
  });

  it("hydrates process.env from .env when options.env is omitted", async () => {
    const configPath = join(tempDir, "ez-devbox.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(configPath, '[startup]\nmode = "prompt"\n');
    await writeFile(envPath, "E2B_API_KEY=from-dotenv\n");

    await loadConfig({ configPath, envPath });

    expect(process.env.E2B_API_KEY).toBe("from-dotenv");
  });

  it("uses options.env when provided even if process env is empty", async () => {
    const configPath = join(tempDir, "ez-devbox.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(configPath, '[startup]\nmode = "prompt"\n');
    await writeFile(envPath, "FIRECRAWL_API_KEY=secret\n");

    const resolved = await loadConfig({
      configPath,
      envPath,
      env: { E2B_API_KEY: "from-options-env" },
    });

    expect(resolved.startup.mode).toBe("prompt");
  });

  it("does not implicitly read process.env when options.env is provided", async () => {
    const configPath = join(tempDir, "ez-devbox.config.toml");
    const envPath = join(tempDir, ".env");
    process.env.E2B_API_KEY = "from-process-env";

    await writeFile(configPath, '[startup]\nmode = "prompt"\n');
    await writeFile(envPath, "FIRECRAWL_API_KEY=secret\n");

    await expect(
      loadConfig({
        configPath,
        envPath,
        env: {},
      }),
    ).rejects.toThrow("E2B_API_KEY");
  });

  it("uses injected options.env instead of process.env when provided", async () => {
    const configPath = join(tempDir, "ez-devbox.config.toml");
    const envPath = join(tempDir, ".env");

    process.env.E2B_API_KEY = "from-process";
    await writeFile(configPath, '[startup]\nmode = "prompt"\n');
    await writeFile(envPath, "FIRECRAWL_API_KEY=secret\n");

    await expect(
      loadConfig({
        configPath,
        envPath,
        env: {},
      }),
    ).rejects.toThrow("E2B_API_KEY");

    await expect(
      loadConfig({
        configPath,
        envPath,
        env: {
          E2B_API_KEY: "from-options",
        },
      }),
    ).resolves.toBeDefined();
  });

  it("applies E2B_API_KEY precedence as .env then options.env override", async () => {
    const configPath = join(tempDir, "ez-devbox.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(configPath, '[startup]\nmode = "prompt"\n');
    await writeFile(envPath, "E2B_API_KEY=from-dotenv\n");

    await expect(
      loadConfig({
        configPath,
        envPath,
        env: {},
      }),
    ).resolves.toBeDefined();

    await expect(
      loadConfig({
        configPath,
        envPath,
        env: {
          E2B_API_KEY: "",
        },
      }),
    ).rejects.toThrow("E2B_API_KEY");
  });

  it("accepts project.active_name when active mode is name", async () => {
    const configPath = join(tempDir, "ez-devbox.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(
      configPath,
      [
        "[project]",
        'active = "name"',
        'active_name = "beta"',
        "",
        "[[project.repos]]",
        'name = "alpha"',
        'url = "https://example.com/alpha.git"',
        "",
        "[[project.repos]]",
        'name = "beta"',
        'url = "https://example.com/beta.git"',
      ].join("\n"),
    );
    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    const resolved = await loadConfig({ configPath, envPath });
    expect(resolved.project.active).toBe("name");
    expect(resolved.project.active_name).toBe("beta");
  });

  it("rejects active=name when project.active_name is missing", async () => {
    const configPath = join(tempDir, "ez-devbox.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(configPath, ["[project]", 'active = "name"'].join("\n"));
    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    await expect(loadConfig({ configPath, envPath })).rejects.toThrow("project.active_name");
  });

  it("accepts project.active_index when active mode is index", async () => {
    const configPath = join(tempDir, "ez-devbox.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(
      configPath,
      [
        "[project]",
        'active = "index"',
        "active_index = 1",
        "",
        "[[project.repos]]",
        'name = "alpha"',
        'url = "https://example.com/alpha.git"',
        "",
        "[[project.repos]]",
        'name = "beta"',
        'url = "https://example.com/beta.git"',
      ].join("\n"),
    );
    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    const resolved = await loadConfig({ configPath, envPath });
    expect(resolved.project.active).toBe("index");
    expect(resolved.project.active_index).toBe(1);
  });

  it("rejects out-of-range project.active_index for active=index", async () => {
    const configPath = join(tempDir, "ez-devbox.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(
      configPath,
      [
        "[project]",
        'active = "index"',
        "active_index = 4",
        "",
        "[[project.repos]]",
        'name = "alpha"',
        'url = "https://example.com/alpha.git"',
      ].join("\n"),
    );
    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    await expect(loadConfig({ configPath, envPath })).rejects.toThrow("project.active_index");
  });

  it("accepts tunnel.ports override", async () => {
    const configPath = join(tempDir, "ez-devbox.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(configPath, ["[tunnel]", "ports = [3002, 8080]"].join("\n"));
    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    const resolved = await loadConfig({ configPath, envPath });
    expect(resolved.tunnel.ports).toEqual([3002, 8080]);
  });

  it("accepts tunnel.targets override", async () => {
    const configPath = join(tempDir, "ez-devbox.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(configPath, ["[tunnel]", "", "[tunnel.targets]", '"3002" = "http://10.0.0.20:3002"'].join("\n"));
    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    const resolved = await loadConfig({ configPath, envPath });
    expect(resolved.tunnel.ports).toEqual([3002]);
    expect(resolved.tunnel.targets).toEqual({
      "3002": "http://10.0.0.20:3002",
    });
  });

  it("uses tunnel.targets as authoritative ports when both are provided", async () => {
    const configPath = join(tempDir, "ez-devbox.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(
      configPath,
      ["[tunnel]", "ports = [8080]", "", "[tunnel.targets]", '"3002" = "http://10.0.0.20:3002"'].join("\n"),
    );
    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    const resolved = await loadConfig({ configPath, envPath });
    expect(resolved.tunnel.ports).toEqual([3002]);
    expect(resolved.tunnel.targets).toEqual({
      "3002": "http://10.0.0.20:3002",
    });
  });

  it("rejects invalid tunnel.targets keys", async () => {
    const configPath = join(tempDir, "ez-devbox.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(
      configPath,
      ["[tunnel]", "", "[tunnel.targets]", 'not_a_port = "http://10.0.0.20:3002"'].join("\n"),
    );
    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    await expect(loadConfig({ configPath, envPath })).rejects.toThrow("tunnel.targets");
  });

  it("rejects invalid tunnel.targets URL values", async () => {
    const configPath = join(tempDir, "ez-devbox.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(configPath, ["[tunnel]", "", "[tunnel.targets]", '"3002" = "not-a-url"'].join("\n"));
    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    await expect(loadConfig({ configPath, envPath })).rejects.toThrow("tunnel.targets");
  });

  it("accepts localhost tunnel.targets", async () => {
    const configPath = join(tempDir, "ez-devbox.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(configPath, ["[tunnel]", "", "[tunnel.targets]", '"3002" = "http://127.0.0.1:3002"'].join("\n"));
    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    const resolved = await loadConfig({ configPath, envPath });
    expect(resolved.tunnel.targets).toEqual({
      "3002": "http://127.0.0.1:3002",
    });
  });

  it("accepts IPv6 localhost tunnel.targets", async () => {
    const configPath = join(tempDir, "ez-devbox.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(configPath, ["[tunnel]", "", "[tunnel.targets]", '"3002" = "http://[::1]:3002"'].join("\n"));
    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    const resolved = await loadConfig({ configPath, envPath });
    expect(resolved.tunnel.targets).toEqual({
      "3002": "http://[::1]:3002",
    });
  });

  it("rejects tunnel.targets URLs that contain credentials", async () => {
    const configPath = join(tempDir, "ez-devbox.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(
      configPath,
      ["[tunnel]", "", "[tunnel.targets]", '"3002" = "http://user:pass@10.0.0.20:3002"'].join("\n"),
    );
    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    await expect(loadConfig({ configPath, envPath })).rejects.toThrow("credentials");
  });

  it("rejects tunnel.targets URLs with query or fragment", async () => {
    const configPath = join(tempDir, "ez-devbox.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(
      configPath,
      ["[tunnel]", "", "[tunnel.targets]", '"3002" = "http://10.0.0.20:3002/path?x=1#frag"'].join("\n"),
    );
    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    await expect(loadConfig({ configPath, envPath })).rejects.toThrow("query/fragment");
  });

  it("rejects invalid tunnel.ports values", async () => {
    const configPath = join(tempDir, "ez-devbox.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(configPath, ["[tunnel]", "ports = [70000]"].join("\n"));
    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    await expect(loadConfig({ configPath, envPath })).rejects.toThrow("tunnel.ports");
  });

  it("rejects duplicate tunnel.ports entries", async () => {
    const configPath = join(tempDir, "ez-devbox.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(configPath, ["[tunnel]", "ports = [3002, 3002]"].join("\n"));
    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    await expect(loadConfig({ configPath, envPath })).rejects.toThrow("duplicate port");
  });

  it("prefers local launcher config over global", async () => {
    const localConfigPath = join(tempDir, "ez-devbox.config.toml");
    const globalConfigRoot = join(tempDir, "xdg");
    const globalConfigPath = join(globalConfigRoot, "ez-devbox", "ez-devbox.config.toml");
    const envPath = join(tempDir, ".env");

    await writeFile(localConfigPath, '[sandbox]\nname = "local"\n');
    await mkdir(join(globalConfigRoot, "ez-devbox"), { recursive: true });
    await writeFile(globalConfigPath, '[sandbox]\nname = "global"\n');
    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    const loaded = await loadConfigWithMetadata({
      cwd: tempDir,
      envPath,
      env: { XDG_CONFIG_HOME: globalConfigRoot },
    });

    expect(loaded.scope).toBe("local");
    expect(loaded.configPath).toBe(localConfigPath);
    expect(loaded.config.sandbox.name).toBe("local");
  });

  it("falls back to global launcher config when local is missing", async () => {
    const globalConfigRoot = join(tempDir, "xdg");
    const globalConfigPath = join(globalConfigRoot, "ez-devbox", "ez-devbox.config.toml");
    const envPath = join(tempDir, ".env");

    await mkdir(join(globalConfigRoot, "ez-devbox"), { recursive: true });
    await writeFile(globalConfigPath, '[sandbox]\nname = "global"\n');
    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    const loaded = await loadConfigWithMetadata({
      cwd: tempDir,
      envPath,
      env: { XDG_CONFIG_HOME: globalConfigRoot },
    });

    expect(loaded.scope).toBe("global");
    expect(loaded.configPath).toBe(globalConfigPath);
    expect(loaded.config.sandbox.name).toBe("global");
  });

  it("creates local launcher config from prompt choice", async () => {
    const envPath = join(tempDir, ".env");
    const localConfigPath = join(tempDir, "ez-devbox.config.toml");

    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    const loaded = await loadConfigWithMetadata({
      cwd: tempDir,
      envPath,
      isInteractiveTerminal: () => true,
      promptInput: async () => "1",
      env: { XDG_CONFIG_HOME: join(tempDir, "xdg") },
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
    const globalConfigPath = join(globalConfigRoot, "ez-devbox", "ez-devbox.config.toml");

    await writeFile(envPath, "E2B_API_KEY=test-e2b-key\n");

    const loaded = await loadConfigWithMetadata({
      cwd: tempDir,
      envPath,
      isInteractiveTerminal: () => true,
      promptInput: async () => "2",
      env: { XDG_CONFIG_HOME: globalConfigRoot },
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
        env: { XDG_CONFIG_HOME: globalConfigRoot },
      }),
    ).rejects.toThrow(
      `Create one at '${join(tempDir, "ez-devbox.config.toml")}' or '${join(globalConfigRoot, "ez-devbox", "ez-devbox.config.toml")}'.`,
    );
  });
});
