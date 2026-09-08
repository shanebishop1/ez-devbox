import { execFile } from "node:child_process";
import { access, chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it, vi } from "vitest";
import type { SandboxHandle } from "../src/e2b/lifecycle.js";
import { ensureSshBridgeDependencies } from "../src/modes/ssh-bridge.dependencies.js";
import {
  allocateSshBridgePorts,
  buildInteractiveRemoteCommand,
  buildSshClientArgs,
  cleanupSshBridgeSession,
  prepareSshBridgeSession,
  type SshBridgeSession,
  stageInteractiveStartupEnv,
} from "../src/modes/ssh-bridge.js";
import { quoteShellArg } from "../src/modes/ssh-bridge.utils.js";

const execFileAsync = promisify(execFile);

describe("ssh bridge security behavior", () => {
  it("allocateSshBridgePorts skips occupied candidates and returns available pair", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("occupied"))
      .mockResolvedValueOnce({ stdout: "24123 24124", stderr: "", exitCode: 0 });

    const ports = await allocateSshBridgePorts({ run } as Pick<SandboxHandle, "run">, "session-abc", 4);

    expect(ports).toEqual({ sshdPort: 24123, websockifyPort: 24124 });
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("allocateSshBridgePorts fails after exhausting attempts", async () => {
    const run = vi.fn().mockRejectedValue(new Error("occupied"));

    await expect(allocateSshBridgePorts({ run } as Pick<SandboxHandle, "run">, "session-abc", 2)).rejects.toThrow(
      "Unable to allocate SSH bridge ports after 2 attempts.",
    );
    expect(run).toHaveBeenCalledTimes(2);
  });

  it("allocateSshBridgePorts ignores marker output from nonzero results", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "24123 24124", stderr: "occupied", exitCode: 1 })
      .mockResolvedValueOnce({ stdout: "25123 25124", stderr: "", exitCode: 0 });

    await expect(allocateSshBridgePorts({ run } as Pick<SandboxHandle, "run">, "session-abc", 2)).resolves.toEqual({
      sshdPort: 25123,
      websockifyPort: 25124,
    });
  });

  it("rejects a nonzero SSH bridge dependency install result", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce({ stdout: "MISSING", stderr: "", exitCode: 0 })
      .mockResolvedValueOnce({ stdout: "", stderr: "apt failed", exitCode: 17 });

    await expect(ensureSshBridgeDependencies({ run })).rejects.toThrow(
      "SSH bridge dependency installation failed with exit code 17: apt failed",
    );
  });

  it("buildSshClientArgs enforces strict host key verification", () => {
    const session: SshBridgeSession = {
      tempDir: "/tmp/ez-devbox-ssh-123",
      privateKeyPath: "/tmp/ez-devbox-ssh-123/id_ed25519",
      knownHostsPath: "/tmp/ez-devbox-ssh-123/known_hosts",
      wsUrl: "wss://8081-sbx.e2b.app",
      remoteUser: "sandbox-user",
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
      remoteUser: "sandbox-user",
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

  it("quotes shell arguments without allowing embedded shell syntax", () => {
    expect(quoteShellArg("path with spaces; $(touch /tmp/pwned) 'quoted'")).toBe(
      "'path with spaces; $(touch /tmp/pwned) '\"'\"'quoted'\"'\"''",
    );
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
        sshdPort: 2222,
        websockifyPort: 8081,
        sshdConfigPath: "/home/user/.ez-devbox-ssh/ssh-test/sshd_config",
        sshdPidPath: "/home/user/.ez-devbox-ssh/ssh-test/sshd.pid",
        websockifyPidPath: "/home/user/.ez-devbox-ssh/ssh-test/websockify.pid",
        websockifyLogPath: "/home/user/.ez-devbox-ssh/ssh-test/websockify.log",
      },
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

  it("prepareSshBridgeSession removes local keys and partial remote artifacts after failure", async () => {
    let sessionDir = "";
    const run = vi.fn().mockImplementation(async (command: string) => {
      if (command.includes("command -v websockify")) {
        return { stdout: "READY", stderr: "", exitCode: 0 };
      }
      if (command.includes("whoami")) {
        return { stdout: "user\n/home/user\n", stderr: "", exitCode: 0 };
      }
      if (command.includes("sshd_port=")) {
        return { stdout: "24000 24001", stderr: "", exitCode: 0 };
      }
      if (command.includes("SSH bridge authorized keys setup")) {
        sessionDir = command.match(/'\/home\/user\/\.ez-devbox-ssh\/(ez-devbox-ssh-[^']+)'/)?.[1] ?? "";
        throw new Error("remote write failed");
      }
      if (command.includes("mkdir -p") && command.includes(".ez-devbox-ssh")) {
        sessionDir = command.match(/'\/home\/user\/\.ez-devbox-ssh\/(ez-devbox-ssh-[^']+)'/)?.[1] ?? "";
        return { stdout: "", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    await expect(prepareSshBridgeSession(createHandle({ run }))).rejects.toThrow("remote write failed");

    expect(sessionDir).not.toBe("");
    await expect(access(join(tmpdir(), sessionDir))).rejects.toBeDefined();
    expect(run.mock.calls.some((call) => call[0].includes(`rm -rf '/home/user/.ez-devbox-ssh/${sessionDir}'`))).toBe(
      true,
    );
  });

  it("batches remote SSH bridge setup while preserving restrictive permissions", async () => {
    const run = vi.fn().mockImplementation(async (command: string) => {
      if (command.includes("command -v websockify")) {
        return { stdout: "READY", stderr: "", exitCode: 0 };
      }
      if (command.includes("whoami")) {
        return { stdout: "user\n/home/user\n", stderr: "", exitCode: 0 };
      }
      if (command.includes("sshd_port=")) {
        return { stdout: "24000 24001", stderr: "", exitCode: 0 };
      }
      if (command.includes("SSH bridge websockify start")) {
        return { stdout: "ssh-ed25519 AAAAhostkey", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const handle = createHandle({ run });

    const session = await prepareSshBridgeSession(handle);
    try {
      expect(run).toHaveBeenCalledTimes(4);
      const setupCommand = String(run.mock.calls[3]?.[0]);
      expect(setupCommand).toContain("set -euo pipefail");
      expect(setupCommand).toContain("SSH bridge host key generation");
      expect(setupCommand).toContain("SSH bridge websockify start");
      expect(setupCommand).toContain("chmod 600");
      expect(await readFile(session.knownHostsPath, "utf8")).toBe("e2b-sandbox ssh-ed25519 AAAAhostkey\n");
    } finally {
      await cleanupSshBridgeSession(handle, session);
    }
  });

  it("reports the failed operation from batched remote setup and cleans up", async () => {
    const run = vi.fn().mockImplementation(async (command: string) => {
      if (command.includes("command -v websockify")) {
        return { stdout: "READY", stderr: "", exitCode: 0 };
      }
      if (command.includes("whoami")) {
        return { stdout: "user\n/home/user\n", stderr: "", exitCode: 0 };
      }
      if (command.includes("sshd_port=")) {
        return { stdout: "24000 24001", stderr: "", exitCode: 0 };
      }
      if (command.includes("SSH bridge host key generation")) {
        return {
          stdout: "",
          stderr: "SSH bridge host key generation failed with exit code 23",
          exitCode: 23,
        };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });

    await expect(prepareSshBridgeSession(createHandle({ run }))).rejects.toThrow(
      "SSH bridge remote setup failed with exit code 23: SSH bridge host key generation failed with exit code 23",
    );
    expect(run.mock.calls.some(([command]) => String(command).includes("rm -rf"))).toBe(true);
  });

  it("executes the batched websockify setup with a pid-writing stub", async () => {
    const remoteHome = await mkdtemp(join(tmpdir(), "ez-devbox-ssh-setup-home-"));
    let setupCommand = "";
    let websockifyPidPath: string | undefined;
    const run = vi.fn().mockImplementation(async (command: string) => {
      if (command.includes("command -v websockify")) {
        return { stdout: "READY", stderr: "", exitCode: 0 };
      }
      if (command.includes("whoami")) {
        return { stdout: `user\n${remoteHome}\n`, stderr: "", exitCode: 0 };
      }
      if (command.includes("sshd_port=")) {
        return { stdout: "24000 24001", stderr: "", exitCode: 0 };
      }
      if (command.includes("SSH bridge websockify start")) {
        setupCommand = command;
        return { stdout: "ssh-ed25519 AAAAhostkey", stderr: "", exitCode: 0 };
      }
      return { stdout: "", stderr: "", exitCode: 0 };
    });
    const stubPath = join(remoteHome, "websockify-stub");
    await writeFile(stubPath, "#!/bin/sh\nsleep 30\n", "utf8");
    await chmod(stubPath, 0o755);

    try {
      const session = await prepareSshBridgeSession(createHandle({ run }));
      const artifacts = session.artifacts;
      if (!artifacts) {
        throw new Error("Expected SSH bridge artifacts in setup execution test.");
      }
      websockifyPidPath = artifacts.websockifyPidPath;

      const executableSetupCommand = setupCommand
        .replace("sudo mkdir -p /run/sshd", `mkdir -p ${join(remoteHome, "run/sshd")}`)
        .replace("sudo /usr/sbin/sshd -f", "true")
        .replace("nohup websockify 0.0.0.0:", `nohup ${stubPath} 0.0.0.0:`);
      const result = await execFileAsync("bash", ["-c", executableSetupCommand], {
        encoding: "utf8",
        timeout: 10_000,
      });

      expect(result.stdout.trim()).toMatch(/^ssh-ed25519 \S+ \S+$/);
      const websockifyPid = Number.parseInt((await readFile(artifacts.websockifyPidPath, "utf8")).trim(), 10);
      expect(websockifyPid).toBeGreaterThan(0);
      expect(await readFile(artifacts.websockifyLogPath, "utf8")).toBe("");
      await rm(session.tempDir, { recursive: true, force: true });
    } finally {
      if (websockifyPidPath) {
        const pidContents = await readFile(websockifyPidPath, "utf8").catch(() => "");
        const websockifyPid = Number.parseInt(pidContents.trim(), 10);
        if (websockifyPid > 0) {
          try {
            process.kill(websockifyPid, "SIGTERM");
          } catch {}
        }
      }
      await rm(remoteHome, { recursive: true, force: true });
    }
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
        sshdPort: 2222,
        websockifyPort: 8081,
        sshdConfigPath: "/home/user/.ez-devbox-ssh/ssh-test/sshd_config",
        sshdPidPath: "/home/user/.ez-devbox-ssh/ssh-test/sshd.pid",
        websockifyPidPath: "/home/user/.ez-devbox-ssh/ssh-test/websockify.pid",
        websockifyLogPath: "/home/user/.ez-devbox-ssh/ssh-test/websockify.log",
      },
    };

    const envScriptPath = await stageInteractiveStartupEnv(handle, session, {
      GOOD_KEY: "value",
      "NOT-VALID": "ignored",
    });

    expect(envScriptPath).toBe("/home/user/.ez-devbox-ssh/ssh-test/startup-env.sh");
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[0]).toContain("chmod 600");
    expect(run.mock.calls[0]?.[0]).toContain("for key in 'GOOD_KEY'");
    expect(run.mock.calls[0]?.[1]).toEqual({
      envs: { GOOD_KEY: "value" },
      timeoutMs: 15_000,
    });
    expect(session.startupEnvScriptPath).toBe("/home/user/.ez-devbox-ssh/ssh-test/startup-env.sh");
  });

  it("rejects a nonzero startup environment staging result", async () => {
    const handle = createHandle({
      run: vi.fn().mockResolvedValue({ stdout: "", stderr: "permission denied", exitCode: 1 }),
    });
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
        sshdPort: 2222,
        websockifyPort: 8081,
        sshdConfigPath: "/home/user/.ez-devbox-ssh/ssh-test/sshd_config",
        sshdPidPath: "/home/user/.ez-devbox-ssh/ssh-test/sshd.pid",
        websockifyPidPath: "/home/user/.ez-devbox-ssh/ssh-test/websockify.pid",
        websockifyLogPath: "/home/user/.ez-devbox-ssh/ssh-test/websockify.log",
      },
    };

    await expect(stageInteractiveStartupEnv(handle, session, { GOOD_KEY: "value" })).rejects.toThrow(
      "SSH bridge startup environment staging failed with exit code 1",
    );
    expect(session.startupEnvScriptPath).toBeUndefined();
  });

  it("buildInteractiveRemoteCommand sources staged env script", () => {
    const command = buildInteractiveRemoteCommand({
      cwd: "/workspace/alpha",
      envScriptPath: "/home/user/.ez-devbox-ssh/ssh-test/startup-env.sh",
      command: "opencode",
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
    kill: overrides.kill ?? vi.fn().mockResolvedValue(undefined),
  };
}
