import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { syncCustomAgentFiles, syncOpenCodeAuthFile } from "../src/tooling/host-sandbox-sync.js";

const tempRoots: string[] = [];

describe("custom agent file sync", () => {
  afterEach(async () => {
    await Promise.all(tempRoots.map((path) => rm(path, { recursive: true, force: true })));
    tempRoots.length = 0;
  });

  it("syncs explicit files, restricts permissions, and preserves unrelated destinations", async () => {
    const root = await mkdtemp(join(tmpdir(), "ez-devbox-custom-sync-"));
    tempRoots.push(root);
    const source = join(root, "auth.json");
    await writeFile(source, '{"token":"secret"}', "utf8");
    const writeFileInSandbox = vi.fn().mockResolvedValue(undefined);
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    const summary = await syncCustomAgentFiles(
      [{ source, destination: "/home/user/.config/my-agent/auth.json", optional: false }],
      { writeFile: writeFileInSandbox, run },
    );

    expect(summary).toEqual({ skippedMissing: false, filesDiscovered: 1, filesWritten: 1, filesUnchanged: 0 });
    expect(writeFileInSandbox).toHaveBeenCalledWith("/home/user/.config/my-agent/auth.json", expect.any(ArrayBuffer));
    expect(String(run.mock.calls[1]?.[0])).toContain("chmod 600 '/home/user/.config/my-agent/auth.json'");
  });

  it("fails required missing sources and skips optional missing sources", async () => {
    const sandbox = { writeFile: vi.fn().mockResolvedValue(undefined) };

    await expect(
      syncCustomAgentFiles(
        [{ source: "/missing/auth.json", destination: "/home/user/.config/agent/auth.json", optional: false }],
        sandbox,
      ),
    ).rejects.toThrow("Custom agent file source is missing");

    await expect(
      syncCustomAgentFiles(
        [{ source: "/missing/optional.json", destination: "/home/user/.config/agent/optional.json", optional: true }],
        sandbox,
      ),
    ).resolves.toEqual({ skippedMissing: true, filesDiscovered: 0, filesWritten: 0, filesUnchanged: 0 });
  });

  it("rejects symlink sources instead of following them", async () => {
    const root = await mkdtemp(join(tmpdir(), "ez-devbox-custom-sync-link-"));
    tempRoots.push(root);
    const target = join(root, "target.json");
    const source = join(root, "link.json");
    await writeFile(target, "secret", "utf8");
    await symlink(target, source);

    await expect(
      syncCustomAgentFiles([{ source, destination: "/home/user/.config/agent/auth.json", optional: false }], {
        writeFile: vi.fn().mockResolvedValue(undefined),
      }),
    ).rejects.toThrow("symbolic links are not supported");
  });

  it("rejects symlinked sandbox destination components before writing", async () => {
    const writeFileInSandbox = vi.fn().mockResolvedValue(undefined);
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 1 });

    await expect(
      syncCustomAgentFiles(
        [{ source: "/missing/auth.json", destination: "/home/user/.config/agent/auth.json", optional: true }],
        { writeFile: writeFileInSandbox, run },
      ),
    ).rejects.toThrow("symlinked sandbox path");
    expect(writeFileInSandbox).not.toHaveBeenCalled();
  });

  it("prepares custom credential permissions before writing bytes", async () => {
    const root = await mkdtemp(join(tmpdir(), "ez-devbox-custom-sync-private-"));
    tempRoots.push(root);
    const source = join(root, "auth.json");
    await writeFile(source, "secret", "utf8");
    const events: string[] = [];
    const run = vi.fn().mockImplementation(async (command: string) => {
      events.push(`run:${command}`);
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const writeFileInSandbox = vi.fn().mockImplementation(async () => {
      events.push("write");
    });

    await syncCustomAgentFiles([{ source, destination: "/home/user/.config/agent/auth.json", optional: false }], {
      writeFile: writeFileInSandbox,
      run,
    });

    expect(events.findIndex((event) => event.includes("chmod 600"))).toBeLessThan(events.indexOf("write"));
  });

  it("keeps the destination private when a custom credential write fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "ez-devbox-custom-sync-failure-"));
    tempRoots.push(root);
    const source = join(root, "auth.json");
    await writeFile(source, "secret", "utf8");
    const events: string[] = [];
    const run = vi.fn().mockImplementation(async (command: string) => {
      events.push(`run:${command}`);
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const writeFileInSandbox = vi.fn().mockImplementation(async () => {
      events.push("write");
      throw new Error("transfer failed");
    });

    await expect(
      syncCustomAgentFiles([{ source, destination: "/home/user/.config/agent/auth.json", optional: false }], {
        writeFile: writeFileInSandbox,
        run,
      }),
    ).rejects.toThrow("transfer failed");
    expect(events.findIndex((event) => event.includes("chmod 600"))).toBeLessThan(events.indexOf("write"));
  });

  it("checks an existing custom destination is a regular file before changing permissions", async () => {
    const root = await mkdtemp(join(tmpdir(), "ez-devbox-custom-sync-directory-"));
    tempRoots.push(root);
    const source = join(root, "auth.json");
    await writeFile(source, "secret", "utf8");
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    await syncCustomAgentFiles([{ source, destination: "/home/user/.config/agent/auth.json", optional: false }], {
      writeFile: vi.fn().mockResolvedValue(undefined),
      run,
    });

    const permissionCommand = String(run.mock.calls[1]?.[0]);
    expect(permissionCommand).toMatch(/\[ -e .*\] && \[ ! -f .*\]/);
    expect(permissionCommand.indexOf("[ -e")).toBeLessThan(permissionCommand.indexOf("chmod 700"));
    expect(permissionCommand.indexOf("[ -e")).toBeLessThan(permissionCommand.indexOf("chown"));
  });

  it("preserves built-in symlink auth-file compatibility", async () => {
    const root = await mkdtemp(join(tmpdir(), "ez-devbox-builtin-sync-link-"));
    tempRoots.push(root);
    const target = join(root, "target.json");
    const source = join(root, "auth.json");
    await writeFile(target, '{"token":"legacy"}', "utf8");
    await symlink(target, source);
    const writeFileInSandbox = vi.fn().mockResolvedValue(undefined);
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });

    await expect(
      syncOpenCodeAuthFile(
        {
          opencode: { config_dir: root, auth_path: source },
          codex: { config_dir: root, auth_path: source },
          claude: { config_dir: root, state_path: source },
          gh: { enabled: false, config_dir: root },
        },
        { writeFile: writeFileInSandbox, run },
      ),
    ).resolves.toMatchObject({ filesWritten: 1 });
  });
});
