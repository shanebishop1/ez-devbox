import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { syncToolingForMode } from "../src/cli/commands.create.sync.js";
import type { ResolvedLauncherConfig } from "../src/config/schema.js";

const tempRoots: string[] = [];

describe("syncToolingForMode", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((path) => rm(path, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it("syncs only the selected agent and restricts transferred permissions", async () => {
    const root = await mkdtemp(join(tmpdir(), "ez-devbox-mode-sync-"));
    tempRoots.push(root);
    const opencodeDir = join(root, "opencode");
    const codexDir = join(root, "codex");
    const claudeDir = join(root, "claude");
    await Promise.all([mkdir(opencodeDir), mkdir(codexDir), mkdir(claudeDir)]);
    await Promise.all([
      writeFile(join(opencodeDir, "config.json"), "opencode"),
      writeFile(join(root, "opencode-auth.json"), "opencode-secret"),
      writeFile(join(codexDir, "config.toml"), "codex"),
      writeFile(join(root, "codex-auth.json"), "codex-secret"),
      writeFile(join(claudeDir, "settings.json"), "claude"),
      writeFile(join(root, "claude-state.json"), "claude-secret"),
    ]);
    const config = createConfig(root);
    const writeSandboxFile = vi.fn().mockResolvedValue(undefined);
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    const summary = await syncToolingForMode(config, { run, writeFile: writeSandboxFile }, "ssh-codex");

    expect(writeSandboxFile).toHaveBeenCalledTimes(2);
    expect(writeSandboxFile).toHaveBeenCalledWith("/home/user/.codex/config.toml", expect.any(ArrayBuffer));
    expect(writeSandboxFile).toHaveBeenCalledWith("/home/user/.codex/auth.json", expect.any(ArrayBuffer));
    expect(writeSandboxFile.mock.calls.flatMap((call) => call[0])).not.toContain("opencode");
    expect(writeSandboxFile.mock.calls.flatMap((call) => call[0])).not.toContain("claude");
    expect(run.mock.calls.map((call) => call[0]).join("\n")).toContain("chmod 700 '/home/user/.codex'");
    expect(run.mock.calls.map((call) => call[0]).join("\n")).toContain("chmod 600 '/home/user/.codex/auth.json'");
    expect(summary.codexConfigSynced).toBe(true);
    expect(summary.codexAuthSynced).toBe(true);
    expect(summary.opencodeConfigSynced).toBe(false);
    expect(summary.claudeConfigSynced).toBe(false);
  });
});

function createConfig(root: string): ResolvedLauncherConfig {
  return {
    sandbox: { template: "base", reuse: true, name: "test", timeout_ms: 1_000, delete_on_exit: false },
    startup: { mode: "ssh-codex" },
    project: {
      mode: "single",
      active: "prompt",
      dir: "/workspace",
      working_dir: "auto",
      setup_on_connect: false,
      setup_retries: 0,
      setup_concurrency: 1,
      setup_continue_on_error: false,
      repos: [],
    },
    env: { pass_through: [] },
    opencode: { config_dir: join(root, "opencode"), auth_path: join(root, "opencode-auth.json") },
    codex: { config_dir: join(root, "codex"), auth_path: join(root, "codex-auth.json") },
    claude: { config_dir: join(root, "claude"), state_path: join(root, "claude-state.json") },
    gh: { enabled: false, config_dir: join(root, "gh") },
    tunnel: { ports: [] },
  };
}
