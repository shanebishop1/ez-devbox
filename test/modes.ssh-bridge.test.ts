import { access, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SandboxHandle } from "../src/e2b/lifecycle.js";
import { buildSshClientArgs, cleanupSshBridgeSession, type SshBridgeSession } from "../src/modes/ssh-bridge.js";

describe("ssh bridge security behavior", () => {
  it("buildSshClientArgs enforces strict host key verification", () => {
    const session: SshBridgeSession = {
      tempDir: "/tmp/agent-box-ssh-123",
      privateKeyPath: "/tmp/agent-box-ssh-123/id_ed25519",
      knownHostsPath: "/tmp/agent-box-ssh-123/known_hosts",
      wsUrl: "wss://8081-sbx.e2b.app"
    };

    const args = buildSshClientArgs(session, "bash");
    const joined = args.join(" ");

    expect(args).toContain("StrictHostKeyChecking=yes");
    expect(joined).toContain("UserKnownHostsFile=");
    expect(joined).not.toContain("StrictHostKeyChecking=no");
    expect(joined).not.toContain("UserKnownHostsFile=/dev/null");
  });

  it("cleanupSshBridgeSession attempts remote cleanup and always cleans local temp dir", async () => {
    const tempDir = await mkdtemp(join(tmpdir(), "agent-box-ssh-cleanup-test-"));
    await writeFile(join(tempDir, "marker.txt"), "cleanup me", "utf8");

    const session: SshBridgeSession = {
      tempDir,
      privateKeyPath: "/tmp/id_ed25519",
      knownHostsPath: "/tmp/known_hosts",
      wsUrl: "wss://8081-sbx.e2b.app",
      artifacts: {
        authorizedKeysPath: "/tmp/ssh-test-authorized_keys",
        hostPrivateKeyPath: "/tmp/ssh-test-host-ed25519",
        hostPublicKeyPath: "/tmp/ssh-test-host-ed25519.pub",
        sshdConfigPath: "/tmp/ssh-test-sshd_config",
        sshdPidPath: "/tmp/ssh-test-sshd.pid",
        websockifyPidPath: "/tmp/ssh-test-websockify.pid",
        websockifyLogPath: "/tmp/ssh-test-websockify.log"
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
    expect(run.mock.calls[0]?.[0]).toContain("ssh-test-websockify.pid");
    expect(run.mock.calls[1]?.[0]).toContain("ssh-test-sshd.pid");
    expect(run.mock.calls[2]?.[0]).toContain("ssh-test-authorized_keys");
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
