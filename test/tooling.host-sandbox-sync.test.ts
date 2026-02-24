import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi, afterEach } from "vitest";
import {
  discoverDirectoryFiles,
  resolveHostPath,
  syncCodexAuthFile,
  syncCodexConfigDir,
  syncOpenCodeAuthFile,
  syncOpenCodeConfigDir,
  syncToolingToSandbox
} from "../src/tooling/host-sandbox-sync.js";

const tempRoots: string[] = [];

describe("host to sandbox tooling sync", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((dir) => rm(dir, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it("expands ~, $HOME, and ${HOME} path prefixes", () => {
    const homeDir = "/tmp/fake-home";

    expect(resolveHostPath("~/.codex", { homeDir })).toBe("/tmp/fake-home/.codex");
    expect(resolveHostPath("$HOME/.codex", { homeDir })).toBe("/tmp/fake-home/.codex");
    expect(resolveHostPath("${HOME}/.codex", { homeDir })).toBe("/tmp/fake-home/.codex");
  });

  it("recursively discovers files while skipping non-config subtrees and artifacts", async () => {
    const root = await createTempRoot("discover");
    const appDir = join(root, "app");
    const nestedDir = join(appDir, "nested");
    const nestedNodeModulesDir = join(appDir, "nested", "node_modules");
    const archivedSessionsDir = join(root, "archived_sessions");
    const logsDir = join(root, "logs");
    const topNodeModulesDir = join(root, "node_modules");
    const vendorImportsDir = join(root, "vendor_imports");
    const shellSnapshotsDir = join(root, "shell_snapshots");
    const sqliteDir = join(root, "sqlite");
    const systemDir = join(root, ".system");
    const curatedDir = join(root, ".curated");

    await mkdir(nestedDir, { recursive: true });
    await mkdir(nestedNodeModulesDir, { recursive: true });
    await mkdir(archivedSessionsDir, { recursive: true });
    await mkdir(logsDir, { recursive: true });
    await mkdir(topNodeModulesDir, { recursive: true });
    await mkdir(vendorImportsDir, { recursive: true });
    await mkdir(shellSnapshotsDir, { recursive: true });
    await mkdir(sqliteDir, { recursive: true });
    await mkdir(systemDir, { recursive: true });
    await mkdir(curatedDir, { recursive: true });
    await writeFile(join(root, "top.txt"), "top");
    await writeFile(join(root, ".DS_Store"), "skip");
    await writeFile(join(root, "history.jsonl"), "skip");
    await writeFile(join(root, ".codex-global-state.json"), "skip");
    await writeFile(join(root, "models_cache.json"), "skip");
    await writeFile(join(root, "cache.db"), "skip");
    await writeFile(join(root, "cache.sqlite"), "skip");
    await writeFile(join(nestedDir, "keep.txt"), "keep");
    await writeFile(join(nestedDir, "keep.log"), "skip");
    await writeFile(join(nestedNodeModulesDir, "ignore.txt"), "ignore");
    await writeFile(join(archivedSessionsDir, "session.json"), "ignore");
    await writeFile(join(logsDir, "run.txt"), "ignore");
    await writeFile(join(topNodeModulesDir, "ignore-too.txt"), "ignore");
    await writeFile(join(vendorImportsDir, "bundled.json"), "ignore");
    await writeFile(join(shellSnapshotsDir, "snapshot.json"), "ignore");
    await writeFile(join(sqliteDir, "state.json"), "ignore");
    await writeFile(join(systemDir, "state.json"), "ignore");
    await writeFile(join(curatedDir, "state.json"), "ignore");

    const discovered = await discoverDirectoryFiles(root);

    expect(discovered).toEqual([join(root, "app", "nested", "keep.txt"), join(root, "top.txt")]);
  });

  it("skips missing local paths without failing", async () => {
    const root = await createTempRoot("missing");
    const config = {
      opencode: {
        config_dir: join(root, "missing-opencode-config"),
        auth_path: join(root, "missing-opencode-auth.json")
      },
      codex: {
        config_dir: join(root, "missing-codex-config"),
        auth_path: join(root, "missing-codex-auth.json")
      },
      gh: {
        enabled: false,
        config_dir: join(root, "missing-gh-config")
      }
    };
    const writeFileInSandbox = vi.fn().mockResolvedValue(undefined);

    const summary = await syncToolingToSandbox(config, { writeFile: writeFileInSandbox });

    expect(writeFileInSandbox).not.toHaveBeenCalled();
    expect(summary).toEqual({
      totalDiscovered: 0,
      totalWritten: 0,
      skippedMissingPaths: 4,
      opencodeConfigSynced: false,
      opencodeAuthSynced: false,
      codexConfigSynced: false,
      codexAuthSynced: false,
      ghEnabled: false,
      ghConfigSynced: false
    });
  });

  it("writes config and auth files to fixed sandbox destinations", async () => {
    const root = await createTempRoot("writes");
    const opencodeConfigDir = join(root, "opencode-config");
    const codexConfigDir = join(root, "codex-config");
    const opencodeAuthPath = join(root, "opencode-auth.json");
    const codexAuthPath = join(root, "codex-auth.json");

    await mkdir(join(opencodeConfigDir, "profiles"), { recursive: true });
    await mkdir(join(opencodeConfigDir, "node_modules", "x"), { recursive: true });
    await mkdir(join(codexConfigDir, "archived_sessions"), { recursive: true });
    await writeFile(join(opencodeConfigDir, "settings.toml"), "opencode=true");
    await writeFile(join(opencodeConfigDir, "profiles", "main.json"), "{}");
    await writeFile(join(opencodeConfigDir, "node_modules", "x", "skip.json"), "{}", "utf8");
    await writeFile(join(codexConfigDir, "config.json"), "{}", "utf8");
    await writeFile(join(codexConfigDir, "archived_sessions", "2026-01-01.jsonl"), "session", "utf8");
    await writeFile(opencodeAuthPath, "{\"token\":\"secret\"}", "utf8");
    await writeFile(codexAuthPath, "{\"token\":\"secret\"}", "utf8");

    const config = {
      opencode: {
        config_dir: opencodeConfigDir,
        auth_path: opencodeAuthPath
      },
      codex: {
        config_dir: codexConfigDir,
        auth_path: codexAuthPath
      },
      gh: {
        enabled: false,
        config_dir: join(root, "unused-gh")
      }
    };
    const writeFileInSandbox = vi.fn().mockResolvedValue(undefined);

    const opencodeConfigSummary = await syncOpenCodeConfigDir(config, { writeFile: writeFileInSandbox });
    const opencodeAuthSummary = await syncOpenCodeAuthFile(config, { writeFile: writeFileInSandbox });
    const codexConfigSummary = await syncCodexConfigDir(config, { writeFile: writeFileInSandbox });
    const codexAuthSummary = await syncCodexAuthFile(config, { writeFile: writeFileInSandbox });

    expect(opencodeConfigSummary).toEqual({ skippedMissing: false, filesDiscovered: 2, filesWritten: 2 });
    expect(opencodeAuthSummary).toEqual({ skippedMissing: false, filesDiscovered: 1, filesWritten: 1 });
    expect(codexConfigSummary).toEqual({ skippedMissing: false, filesDiscovered: 1, filesWritten: 1 });
    expect(codexAuthSummary).toEqual({ skippedMissing: false, filesDiscovered: 1, filesWritten: 1 });

    expect(writeFileInSandbox).toHaveBeenCalledWith(
      "/home/user/.config/opencode/settings.toml",
      expect.any(ArrayBuffer)
    );
    expect(writeFileInSandbox).toHaveBeenCalledWith(
      "/home/user/.config/opencode/profiles/main.json",
      expect.any(ArrayBuffer)
    );
    expect(writeFileInSandbox).toHaveBeenCalledWith(
      "/home/user/.local/share/opencode/auth.json",
      expect.any(ArrayBuffer)
    );
    expect(writeFileInSandbox).toHaveBeenCalledWith("/home/user/.codex/config.json", expect.any(ArrayBuffer));
    expect(writeFileInSandbox).toHaveBeenCalledWith("/home/user/.codex/auth.json", expect.any(ArrayBuffer));
    expect(writeFileInSandbox).not.toHaveBeenCalledWith(
      "/home/user/.codex/archived_sessions/2026-01-01.jsonl",
      expect.any(ArrayBuffer)
    );
  });

  it("reports incremental directory sync progress", async () => {
    const root = await createTempRoot("progress");
    const codexConfigDir = join(root, "codex-config");
    const codexAuthPath = join(root, "codex-auth.json");

    await mkdir(codexConfigDir, { recursive: true });
    await writeFile(join(codexConfigDir, "a.toml"), "a", "utf8");
    await writeFile(join(codexConfigDir, "b.toml"), "b", "utf8");
    await writeFile(join(codexConfigDir, "c.toml"), "c", "utf8");
    await writeFile(codexAuthPath, "{}", "utf8");

    const config = {
      opencode: {
        config_dir: join(root, "unused-opencode"),
        auth_path: join(root, "unused-opencode-auth.json")
      },
      codex: {
        config_dir: codexConfigDir,
        auth_path: codexAuthPath
      },
      gh: {
        enabled: false,
        config_dir: join(root, "unused-gh")
      }
    };
    const writeFileInSandbox = vi.fn().mockResolvedValue(undefined);
    const onProgress = vi.fn();

    const summary = await syncCodexConfigDir(config, { writeFile: writeFileInSandbox }, { onProgress });

    expect(summary).toEqual({ skippedMissing: false, filesDiscovered: 3, filesWritten: 3 });
    expect(onProgress).toHaveBeenCalledTimes(3);
    expect(onProgress).toHaveBeenNthCalledWith(1, { filesWritten: 1, filesDiscovered: 3 });
    expect(onProgress).toHaveBeenNthCalledWith(2, { filesWritten: 2, filesDiscovered: 3 });
    expect(onProgress).toHaveBeenNthCalledWith(3, { filesWritten: 3, filesDiscovered: 3 });
  });

  it("excludes codex archived_sessions history artifacts from sync", async () => {
    const root = await createTempRoot("codex-archives");
    const codexConfigDir = join(root, "codex-config");

    await mkdir(join(codexConfigDir, "archived_sessions"), { recursive: true });
    await mkdir(join(codexConfigDir, "vendor_imports"), { recursive: true });
    await mkdir(join(codexConfigDir, "shell_snapshots"), { recursive: true });
    await mkdir(join(codexConfigDir, "sqlite"), { recursive: true });
    await mkdir(join(codexConfigDir, ".system"), { recursive: true });
    await mkdir(join(codexConfigDir, ".curated"), { recursive: true });
    await writeFile(join(codexConfigDir, "config.toml"), "model = \"gpt-5\"", "utf8");
    await writeFile(join(codexConfigDir, "archived_sessions", "last-session.jsonl"), "history", "utf8");
    await writeFile(join(codexConfigDir, "activity.log"), "history", "utf8");
    await writeFile(join(codexConfigDir, "vendor_imports", "registry.json"), "history", "utf8");
    await writeFile(join(codexConfigDir, "shell_snapshots", "snapshot.json"), "history", "utf8");
    await writeFile(join(codexConfigDir, "sqlite", "config.toml"), "history", "utf8");
    await writeFile(join(codexConfigDir, ".system", "state.json"), "history", "utf8");
    await writeFile(join(codexConfigDir, ".curated", "catalog.json"), "history", "utf8");
    await writeFile(join(codexConfigDir, ".codex-global-state.json"), "history", "utf8");
    await writeFile(join(codexConfigDir, "models_cache.json"), "history", "utf8");
    await writeFile(join(codexConfigDir, "state.db"), "history", "utf8");
    await writeFile(join(codexConfigDir, "state.sqlite"), "history", "utf8");

    const config = {
      opencode: {
        config_dir: join(root, "unused-opencode"),
        auth_path: join(root, "unused-opencode-auth.json")
      },
      codex: {
        config_dir: codexConfigDir,
        auth_path: join(root, "unused-codex-auth.json")
      },
      gh: {
        enabled: false,
        config_dir: join(root, "unused-gh")
      }
    };
    const writeFileInSandbox = vi.fn().mockResolvedValue(undefined);

    const summary = await syncCodexConfigDir(config, { writeFile: writeFileInSandbox });

    expect(summary).toEqual({ skippedMissing: false, filesDiscovered: 1, filesWritten: 1 });
    expect(writeFileInSandbox).toHaveBeenCalledWith("/home/user/.codex/config.toml", expect.any(ArrayBuffer));
    expect(writeFileInSandbox).not.toHaveBeenCalledWith(
      "/home/user/.codex/archived_sessions/last-session.jsonl",
      expect.any(ArrayBuffer)
    );
    expect(writeFileInSandbox).not.toHaveBeenCalledWith(
      "/home/user/.codex/activity.log",
      expect.any(ArrayBuffer)
    );
    expect(writeFileInSandbox).not.toHaveBeenCalledWith(
      "/home/user/.codex/vendor_imports/registry.json",
      expect.any(ArrayBuffer)
    );
    expect(writeFileInSandbox).not.toHaveBeenCalledWith(
      "/home/user/.codex/shell_snapshots/snapshot.json",
      expect.any(ArrayBuffer)
    );
    expect(writeFileInSandbox).not.toHaveBeenCalledWith(
      "/home/user/.codex/sqlite/config.toml",
      expect.any(ArrayBuffer)
    );
    expect(writeFileInSandbox).not.toHaveBeenCalledWith(
      "/home/user/.codex/.system/state.json",
      expect.any(ArrayBuffer)
    );
    expect(writeFileInSandbox).not.toHaveBeenCalledWith(
      "/home/user/.codex/.curated/catalog.json",
      expect.any(ArrayBuffer)
    );
    expect(writeFileInSandbox).not.toHaveBeenCalledWith(
      "/home/user/.codex/.codex-global-state.json",
      expect.any(ArrayBuffer)
    );
    expect(writeFileInSandbox).not.toHaveBeenCalledWith(
      "/home/user/.codex/models_cache.json",
      expect.any(ArrayBuffer)
    );
    expect(writeFileInSandbox).not.toHaveBeenCalledWith(
      "/home/user/.codex/state.db",
      expect.any(ArrayBuffer)
    );
    expect(writeFileInSandbox).not.toHaveBeenCalledWith(
      "/home/user/.codex/state.sqlite",
      expect.any(ArrayBuffer)
    );
  });

  it("includes gh config in summary only when enabled", async () => {
    const root = await createTempRoot("gh-enabled");
    const ghConfigDir = join(root, "gh-config");
    const codexConfigDir = join(root, "codex-config");
    const codexAuthPath = join(root, "codex-auth.json");

    await mkdir(ghConfigDir, { recursive: true });
    await mkdir(codexConfigDir, { recursive: true });
    await writeFile(join(ghConfigDir, "hosts.yml"), "github.com:\n  user: test\n", "utf8");
    await writeFile(join(codexConfigDir, "config.toml"), "model='gpt-5'", "utf8");
    await writeFile(codexAuthPath, "{}", "utf8");

    const config = {
      opencode: {
        config_dir: join(root, "missing-opencode-config"),
        auth_path: join(root, "missing-opencode-auth.json")
      },
      codex: {
        config_dir: codexConfigDir,
        auth_path: codexAuthPath
      },
      gh: {
        enabled: true,
        config_dir: ghConfigDir
      }
    };
    const writeFileInSandbox = vi.fn().mockResolvedValue(undefined);

    const summary = await syncToolingToSandbox(config, { writeFile: writeFileInSandbox });

    expect(summary).toEqual({
      totalDiscovered: 3,
      totalWritten: 3,
      skippedMissingPaths: 2,
      opencodeConfigSynced: false,
      opencodeAuthSynced: false,
      codexConfigSynced: true,
      codexAuthSynced: true,
      ghEnabled: true,
      ghConfigSynced: true
    });
    expect(writeFileInSandbox).toHaveBeenCalledWith("/home/user/.config/gh/hosts.yml", expect.any(ArrayBuffer));
  });
});

async function createTempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `agent-box-${prefix}-`));
  tempRoots.push(root);
  return root;
}
