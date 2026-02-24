import { access, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { SandboxHandle } from "../src/e2b/lifecycle.js";
import {
  buildInteractiveRemoteCommand,
  buildSshClientArgs,
  cleanupSshBridgeSession,
  stageInteractiveStartupEnv,
  type SshBridgeSession
} from "../src/modes/ssh-bridge.js";

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

  it("buildSshClientArgs resolves proxy script independent of cwd", async () => {
    const session: SshBridgeSession = {
      tempDir: "/tmp/ez-devbox-ssh-123",
      privateKeyPath: "/tmp/ez-devbox-ssh-123/id_ed25519",
      knownHostsPath: "/tmp/ez-devbox-ssh-123/known_hosts",
      wsUrl: "wss://8081-sbx.e2b.app",
      remoteUser: "sandbox-user"
    };

    const originalCwd = process.cwd();
    const isolatedCwd = await mkdtemp(join(tmpdir(), "ez-devbox-cwd-test-"));

    try {
      process.chdir(isolatedCwd);
      const args = buildSshClientArgs(session, "bash");
      const proxyArg = args.find((arg) => arg.startsWith("ProxyCommand="));

      expect(proxyArg).toBeDefined();
      expect(proxyArg).toContain("ws-ssh-proxy.mjs");
      expect(proxyArg).not.toContain(`${isolatedCwd}/scripts/ws-ssh-proxy.mjs`);
    } finally {
      process.chdir(originalCwd);
      await rm(isolatedCwd, { recursive: true, force: true });
    }
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

  it("stageInteractiveStartupEnv writes restrictive env script with valid keys only", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    const handle = createHandle({ run });
    const session: SshBridgeSession = {
      tempDir: "/tmp/local-session",
      privateKeyPath: "/tmp/local-session/id_ed25519",
      knownHostsPath: "/tmp/local-session/known_hosts",
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

    const envScriptPath = await stageInteractiveStartupEnv(handle, session, {
      GOOD_KEY: "value",
      "NOT-VALID": "ignored"
    });

    expect(envScriptPath).toBe("/home/user/.ez-devbox-ssh/ssh-test/startup-env.sh");
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toContain("chmod 600");
    expect(run.mock.calls[0]?.[0]).toContain("for key in 'GOOD_KEY'");
    expect(run.mock.calls[0]?.[1]).toEqual({
      envs: { GOOD_KEY: "value" },
      timeoutMs: 15_000
    });
    expect(session.startupEnvScriptPath).toBe("/home/user/.ez-devbox-ssh/ssh-test/startup-env.sh");
  });

  it("buildInteractiveRemoteCommand sources staged env script", () => {
    const command = buildInteractiveRemoteCommand({
      cwd: "/workspace/alpha",
      envScriptPath: "/home/user/.ez-devbox-ssh/ssh-test/startup-env.sh",
      command: "opencode"
    });

    expect(command).toContain("cd");
    expect(command).toContain("/workspace/alpha");
    expect(command).toContain("source");
    expect(command).toContain("/home/user/.ez-devbox-ssh/ssh-test/startup-env.sh");
    expect(command).toContain("exec opencode");
    expect(command).not.toContain("export GOOD_KEY");
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
