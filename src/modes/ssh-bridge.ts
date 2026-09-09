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
    await chmod(privateKeyPath, 0o600);

    const publicKey = (await readFile(`${privateKeyPath}.pub`, "utf8")).trim();
    if (publicKey === "") {
      throw new Error("Generated SSH public key is empty.");
    }

    const sessionId = basename(tempDir);
    const remoteIdentityResult = await handle.run(
      `bash -lc ${quoteShellArg('printf "%s\\n%s\\n" "$(whoami)" "$HOME"')}`,
      { timeoutMs: SSH_SHORT_TIMEOUT_MS },
    );
    assertRemoteCommandSucceeded(remoteIdentityResult, "SSH bridge remote identity lookup");
    const [remoteUserLine, remoteHomeLine] = remoteIdentityResult.stdout.split(/\r?\n/);
    const remoteUser = remoteUserLine?.trim() || SSH_USER_FALLBACK;
    const remoteHome = remoteHomeLine?.trim() ?? "";
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

    const publicKeyBase64 = Buffer.from(publicKey, "utf8").toString("base64");
    logger.verbose("SSH bridge: configuring remote sshd/websockify.");
    const setupResult = await handle.run(
      buildSshBridgeSetupCommand(artifacts, publicKeyBase64, buildSshdConfig(artifacts)),
      { timeoutMs: SSH_SHORT_TIMEOUT_MS },
    );
    assertRemoteCommandSucceeded(setupResult, "SSH bridge remote setup");

    const hostPublicKey = setupResult.stdout.trim();
    if (hostPublicKey === "") {
      throw new Error("Failed to load SSH host public key.");
    }

    const knownHostEntry = `${SSH_HOST} ${hostPublicKey}\n`;
    await writeFile(knownHostsPath, knownHostEntry);
    await chmod(knownHostsPath, 0o600);

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

function buildSshBridgeSetupCommand(
  artifacts: SshBridgeSessionArtifacts,
  publicKeyBase64: string,
  sshdConfig: string,
): string {
  const sshRootDir = posix.dirname(artifacts.sessionDir);
  const authorizedKeysCommand = [
    `printf %s ${quoteShellArg(publicKeyBase64)} | base64 -d > ${quoteShellArg(artifacts.authorizedKeysPath)}`,
    `chmod 600 ${quoteShellArg(artifacts.authorizedKeysPath)}`,
  ].join(" && ");
  const configBase64 = Buffer.from(sshdConfig, "utf8").toString("base64");
  const configCommand = [
    `printf %s ${quoteShellArg(configBase64)} | base64 -d > ${quoteShellArg(artifacts.sshdConfigPath)}`,
    `chmod 600 ${quoteShellArg(artifacts.sshdConfigPath)}`,
  ].join(" && ");
  const websockifyCommand = [
    `nohup websockify 0.0.0.0:${artifacts.websockifyPort} 127.0.0.1:${artifacts.sshdPort} >${quoteShellArg(
      artifacts.websockifyLogPath,
    )} 2>&1 & pid=$!`,
    `if printf '%s\\n' "$pid" > ${quoteShellArg(artifacts.websockifyPidPath)}; then :; else kill "$pid" >/dev/null 2>&1 || true; exit 1; fi`,
  ].join("\n");
  const script = [
    "set -euo pipefail",
    'run_step() { operation=$1; shift; if "$@"; then return 0; else status=$?; printf \'SSH bridge %s failed with exit code %s\\n\' "$operation" "$status" >&2; exit "$status"; fi; }',
    'capture_step() { operation=$1; shift; if output=$("$@"); then printf \'%s\' "$output"; return 0; else status=$?; printf \'SSH bridge %s failed with exit code %s\\n\' "$operation" "$status" >&2; exit "$status"; fi; }',
    "umask 077",
    `run_step ${quoteShellArg("SSH bridge root directory setup")} mkdir -p ${quoteShellArg(sshRootDir)}`,
    `run_step ${quoteShellArg("SSH bridge root directory permissions")} chmod 700 ${quoteShellArg(sshRootDir)}`,
    `run_step ${quoteShellArg("SSH bridge session directory cleanup")} rm -rf ${quoteShellArg(artifacts.sessionDir)}`,
    `run_step ${quoteShellArg("SSH bridge session directory setup")} mkdir -p ${quoteShellArg(artifacts.sessionDir)}`,
    `run_step ${quoteShellArg("SSH bridge session directory permissions")} chmod 700 ${quoteShellArg(artifacts.sessionDir)}`,
    `run_step ${quoteShellArg("SSH bridge authorized keys setup")} sh -c ${quoteShellArg(authorizedKeysCommand)}`,
    `run_step ${quoteShellArg("SSH bridge host key generation")} ssh-keygen -t ed25519 -N ${quoteShellArg("")} -f ${quoteShellArg(
      artifacts.hostPrivateKeyPath,
    )} -q`,
    `host_public_key=$(capture_step ${quoteShellArg("SSH bridge host public key read")} cat ${quoteShellArg(
      artifacts.hostPublicKeyPath,
    )})`,
    'if [ -z "$host_public_key" ]; then printf "%s\\n" "SSH bridge host public key read failed: generated key is empty" >&2; exit 1; fi',
    `run_step ${quoteShellArg("SSH bridge sshd configuration")} sh -c ${quoteShellArg(configCommand)}`,
    `run_step ${quoteShellArg("SSH bridge sshd runtime directory setup")} sudo mkdir -p /run/sshd`,
    `run_step ${quoteShellArg("SSH bridge sshd start")} sudo /usr/sbin/sshd -f ${quoteShellArg(artifacts.sshdConfigPath)}`,
    `run_step ${quoteShellArg("SSH bridge websockify start")} sh -c ${quoteShellArg(websockifyCommand)}`,
    'printf "%s\\n" "$host_public_key"',
  ].join("\n");

  return `bash -lc ${quoteShellArg(script)}`;
}
