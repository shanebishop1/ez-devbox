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

  it("recursively discovers files while skipping node_modules subtrees", async () => {
    const root = await createTempRoot("discover");
    const appDir = join(root, "app");
    const nestedDir = join(appDir, "nested");
    const nestedNodeModulesDir = join(appDir, "nested", "node_modules");
    const topNodeModulesDir = join(root, "node_modules");

    await mkdir(nestedDir, { recursive: true });
    await mkdir(nestedNodeModulesDir, { recursive: true });
    await mkdir(topNodeModulesDir, { recursive: true });
    await writeFile(join(root, "top.txt"), "top");
    await writeFile(join(nestedDir, "keep.txt"), "keep");
    await writeFile(join(nestedNodeModulesDir, "ignore.txt"), "ignore");
    await writeFile(join(topNodeModulesDir, "ignore-too.txt"), "ignore");

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
      codexAuthSynced: false
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
    await mkdir(codexConfigDir, { recursive: true });
    await writeFile(join(opencodeConfigDir, "settings.toml"), "opencode=true");
    await writeFile(join(opencodeConfigDir, "profiles", "main.json"), "{}");
    await writeFile(join(opencodeConfigDir, "node_modules", "x", "skip.json"), "{}", "utf8");
    await writeFile(join(codexConfigDir, "config.json"), "{}", "utf8");
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
  });
});

async function createTempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), `agent-box-${prefix}-`));
  tempRoots.push(root);
  return root;
}
