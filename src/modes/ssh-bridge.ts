import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, posix } from "node:path";
import type { SandboxHandle } from "../e2b/lifecycle.js";
import { logger } from "../logging/logger.js";
import { assertRemoteCommandSucceeded } from "./remote-command.js";
import { cleanupSshBridgeSession } from "./ssh-bridge.cleanup.js";
import { buildSshdConfig, runLocalCommand } from "./ssh-bridge.commands.js";
import { SSH_HOST, SSH_SHORT_TIMEOUT_MS, SSH_USER_FALLBACK } from "./ssh-bridge.constants.js";
import { ensureSshBridgeDependencies } from "./ssh-bridge.dependencies.js";
import { allocateSshBridgePorts } from "./ssh-bridge.ports.js";
import type { SshBridgePorts, SshBridgeSession, SshBridgeSessionArtifacts, SshModeDeps } from "./ssh-bridge.types.js";
import { quoteShellArg, toWsUrl } from "./ssh-bridge.utils.js";

export { buildInteractiveRemoteCommand, buildSshClientArgs, runInteractiveSshSession } from "./ssh-bridge.commands.js";
export { allocateSshBridgePorts } from "./ssh-bridge.ports.js";
export { stageInteractiveStartupEnv } from "./ssh-bridge.startup-env.js";
export type { SshBridgePorts, SshBridgeSession, SshBridgeSessionArtifacts, SshModeDeps };
export { cleanupSshBridgeSession };

export async function prepareSshBridgeSession(handle: SandboxHandle): Promise<SshBridgeSession> {
  logger.verbose("SSH bridge: checking/installing dependencies.");
  await ensureSshBridgeDependencies(handle);

  const tempDir = await mkdtemp(join(tmpdir(), "ez-devbox-ssh-"));
  const privateKeyPath = join(tempDir, "id_ed25519");
  const knownHostsPath = join(tempDir, "known_hosts");
  let artifacts: SshBridgeSessionArtifacts | undefined;

  try {
    logger.verbose("SSH bridge: generating local key pair.");
    await runLocalCommand("ssh-keygen", ["-t", "ed25519", "-N", "", "-f", privateKeyPath, "-q"], SSH_SHORT_TIMEOUT_MS);

    const publicKey = (await readFile(`${privateKeyPath}.pub`, "utf8")).trim();
    if (publicKey === "") {
      throw new Error("Generated SSH public key is empty.");
    }

    const sessionId = basename(tempDir);
    const remoteUserResult = await handle.run("whoami", { timeoutMs: SSH_SHORT_TIMEOUT_MS });
    assertRemoteCommandSucceeded(remoteUserResult, "SSH bridge remote user lookup");
    const remoteUser = remoteUserResult.stdout.trim() || SSH_USER_FALLBACK;
    const remoteHomeResult = await handle.run("bash -lc 'printf %s \"$HOME\"'", { timeoutMs: SSH_SHORT_TIMEOUT_MS });
    assertRemoteCommandSucceeded(remoteHomeResult, "SSH bridge remote home lookup");
    const remoteHome = remoteHomeResult.stdout.trim();
    if (remoteHome === "") {
      throw new Error("Failed to resolve remote home directory for SSH bridge session.");
    }
    const sshRootDir = posix.join(remoteHome, ".ez-devbox-ssh");
    const sessionDir = posix.join(sshRootDir, sessionId);
    const ports = await allocateSshBridgePorts(handle, sessionId);
    logger.verbose(`SSH bridge: selected ports sshd=${ports.sshdPort}, websockify=${ports.websockifyPort}.`);
    artifacts = {
      sessionDir,
      authorizedKeysPath: posix.join(sessionDir, "authorized_keys"),
      hostPrivateKeyPath: posix.join(sessionDir, "host-ed25519"),
      hostPublicKeyPath: posix.join(sessionDir, "host-ed25519.pub"),
      sshdPort: ports.sshdPort,
      websockifyPort: ports.websockifyPort,
      sshdConfigPath: posix.join(sessionDir, "sshd_config"),
      sshdPidPath: posix.join(sessionDir, "sshd.pid"),
      websockifyPidPath: posix.join(sessionDir, "websockify.pid"),
      websockifyLogPath: posix.join(sessionDir, "websockify.log"),
    } satisfies SshBridgeSessionArtifacts;

    logger.verbose("SSH bridge: configuring remote sshd/websockify.");
    const directorySetupResult = await handle.run(
      `bash -lc 'mkdir -p ${quoteShellArg(sshRootDir)} && chmod 700 ${quoteShellArg(
        sshRootDir,
      )} && rm -rf ${quoteShellArg(sessionDir)} && mkdir -p ${quoteShellArg(sessionDir)} && chmod 700 ${quoteShellArg(sessionDir)}'`,
      { timeoutMs: SSH_SHORT_TIMEOUT_MS },
    );
    assertRemoteCommandSucceeded(directorySetupResult, "SSH bridge session directory setup");

    const publicKeyBase64 = Buffer.from(publicKey, "utf8").toString("base64");

    const authorizedKeysResult = await handle.run(
      `bash -lc 'printf %s ${publicKeyBase64} | base64 -d > ${quoteShellArg(artifacts.authorizedKeysPath)} && chmod 600 ${quoteShellArg(artifacts.authorizedKeysPath)}'`,
      { timeoutMs: SSH_SHORT_TIMEOUT_MS },
    );
    assertRemoteCommandSucceeded(authorizedKeysResult, "SSH bridge authorized keys setup");

    const hostKeyGenerationResult = await handle.run(
      `ssh-keygen -t ed25519 -N "" -f ${quoteShellArg(artifacts.hostPrivateKeyPath)} -q`,
      {
        timeoutMs: SSH_SHORT_TIMEOUT_MS,
      },
    );
    assertRemoteCommandSucceeded(hostKeyGenerationResult, "SSH bridge host key generation");

    const hostKeyResult = await handle.run(`bash -lc 'cat ${quoteShellArg(artifacts.hostPublicKeyPath)}'`, {
      timeoutMs: SSH_SHORT_TIMEOUT_MS,
    });
    assertRemoteCommandSucceeded(hostKeyResult, "SSH bridge host public key read");

    const hostPublicKey = hostKeyResult.stdout.trim();
    if (hostPublicKey === "") {
      throw new Error("Failed to load SSH host public key.");
    }

    const knownHostEntry = `${SSH_HOST} ${hostPublicKey}\n`;
    await writeFile(knownHostsPath, knownHostEntry);
    await chmod(knownHostsPath, 0o600);

    const sshdConfigResult = await handle.run(
      `bash -lc 'cat > ${quoteShellArg(artifacts.sshdConfigPath)} <<"EOF"\n${buildSshdConfig(artifacts)}\nEOF'`,
      { timeoutMs: SSH_SHORT_TIMEOUT_MS },
    );
    assertRemoteCommandSucceeded(sshdConfigResult, "SSH bridge sshd configuration");

    const sshdRuntimeDirectoryResult = await handle.run("sudo mkdir -p /run/sshd", {
      timeoutMs: SSH_SHORT_TIMEOUT_MS,
    });
    assertRemoteCommandSucceeded(sshdRuntimeDirectoryResult, "SSH bridge sshd runtime directory setup");
    const sshdStartResult = await handle.run(`sudo /usr/sbin/sshd -f ${quoteShellArg(artifacts.sshdConfigPath)}`, {
      timeoutMs: SSH_SHORT_TIMEOUT_MS,
    });
    assertRemoteCommandSucceeded(sshdStartResult, "SSH bridge sshd start");
    const websockifyStartResult = await handle.run(
      `nohup websockify 0.0.0.0:${artifacts.websockifyPort} 127.0.0.1:${artifacts.sshdPort} >${quoteShellArg(
        artifacts.websockifyLogPath,
      )} 2>&1 & echo $! > ${quoteShellArg(artifacts.websockifyPidPath)}`,
      { timeoutMs: SSH_SHORT_TIMEOUT_MS },
    );
    assertRemoteCommandSucceeded(websockifyStartResult, "SSH bridge websockify start");

    const wsUrl = toWsUrl(await handle.getHost(artifacts.websockifyPort));
    logger.verbose(`SSH bridge ready: ${wsUrl}`);

    return {
      tempDir,
      privateKeyPath,
      knownHostsPath,
      wsUrl,
      remoteUser,
      artifacts,
    };
  } catch (error) {
    await cleanupSshBridgeSession(handle, {
      tempDir,
      privateKeyPath,
      knownHostsPath,
      wsUrl: "",
      remoteUser: SSH_USER_FALLBACK,
      artifacts,
    });
    throw error;
  }
}
