import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SandboxHandle } from "../src/e2b/lifecycle.js";
import { buildSshClientArgs, cleanupSshBridgeSession, type SshBridgeSession } from "../src/modes/ssh-bridge.js";

describe("ssh bridge security behavior", () => {
  it("buildSshClientArgs enforces strict host key verification", () => {
    const session: SshBridgeSession = {
      tempDir: "/tmp/ez-devbox-ssh-123",
      privateKeyPath: "/tmp/ez-devbox-ssh-123/id_ed25519",
      knownHostsPath: "/tmp/ez-devbox-ssh-123/known_hosts",
      wsUrl: "wss://8081-sbx.e2b.app",
      remoteUser: "sandbox-user"
    };

    const args = buildSshClientArgs(session, "bash");
    const joined = args.join(" ");

    expect(args).toContain("StrictHostKeyChecking=yes");
    expect(joined).toContain("UserKnownHostsFile=");
    expect(args).toContain("sandbox-user@e2b-sandbox");
    expect(joined).not.toContain("StrictHostKeyChecking=no");
    expect(joined).not.toContain("UserKnownHostsFile=/dev/null");
  });

  it("cleanupSshBridgeSession attempts remote cleanup and always cleans local temp dir", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "ez-devbox-ssh-cleanup-test-"));
    await writeFile(join(tempDir, "marker.txt"), "cleanup me", "utf8");

    const session: SshBridgeSession = {
      tempDir,
      privateKeyPath: "/tmp/id_ed25519",
      knownHostsPath: "/tmp/known_hosts",
      wsUrl: "wss://8081-sbx.e2b.app",
      artifacts: {
        sessionDir: "/home/user/.ez-devbox-ssh/ssh-test",
        authorizedKeysPath: "/home/user/.ez-devbox-ssh/ssh-test/authorized_keys",
        hostPrivateKeyPath: "/home/user/.ez-devbox-ssh/ssh-test/host-ed25519",
        hostPublicKeyPath: "/home/user/.ez-devbox-ssh/ssh-test/host-ed25519.pub",
        sshdConfigPath: "/home/user/.ez-devbox-ssh/ssh-test/sshd_config",
        sshdPidPath: "/home/user/.ez-devbox-ssh/ssh-test/sshd.pid",
        websockifyPidPath: "/home/user/.ez-devbox-ssh/ssh-test/websockify.pid",
        websockifyLogPath: "/home/user/.ez-devbox-ssh/ssh-test/websockify.log"
      }
    };

    const run = vi.fn().mockImplementation(async (command: string) => {
      if (command.includes("ssh-test-websockify.pid")) {
        throw new Error("expected cleanup failure");
      }

      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const handle = createHandle({ run });

    await cleanupSshBridgeSession(handle, session);

    expect(run).toHaveBeenCalledTimes(3);
    expect(run.mock.calls[0]?.[0]).toContain("/home/user/.ez-devbox-ssh/ssh-test/websockify.pid");
    expect(run.mock.calls[1]?.[0]).toContain("/home/user/.ez-devbox-ssh/ssh-test/sshd.pid");
    expect(run.mock.calls[2]?.[0]).toContain("/home/user/.ez-devbox-ssh/ssh-test/authorized_keys");
    expect(run.mock.calls[2]?.[0]).toContain("rm -rf '/home/user/.ez-devbox-ssh/ssh-test'");
    await expect(access(tempDir)).rejects.toBeDefined();
  });
});

function createHandle(overrides: Partial<SandboxHandle>): SandboxHandle {
  return {
    sandboxId: "sbx-ssh-1",
    run: overrides.run ?? vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 }),
    writeFile: overrides.writeFile ?? vi.fn().mockResolvedValue(undefined),
    getHost: overrides.getHost ?? vi.fn().mockResolvedValue("https://sbx-ssh-1.e2b.dev"),
    setTimeout: overrides.setTimeout ?? vi.fn().mockResolvedValue(undefined),
    kill: overrides.kill ?? vi.fn().mockResolvedValue(undefined)
  };
}
