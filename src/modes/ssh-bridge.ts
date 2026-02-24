import { execFile, spawn } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import type { SandboxHandle } from "../e2b/lifecycle.js";
import { logger } from "../logging/logger.js";

const SSH_SETUP_TIMEOUT_MS = 8 * 60 * 1000;
const SSH_SHORT_TIMEOUT_MS = 15_000;
const SSH_HOST = "e2b-sandbox";
const SSH_USER_FALLBACK = "user";
const SSHD_PORT = 2222;
const WEBSOCKIFY_PORT = 8081;

export interface SshBridgeSessionArtifacts {
  sessionDir: string;
  authorizedKeysPath: string;
  hostPrivateKeyPath: string;
  hostPublicKeyPath: string;
  sshdConfigPath: string;
  sshdPidPath: string;
  websockifyPidPath: string;
  websockifyLogPath: string;
}

export interface SshBridgeSession {
  tempDir: string;
  privateKeyPath: string;
  knownHostsPath: string;
  wsUrl: string;
  remoteUser?: string;
  artifacts?: SshBridgeSessionArtifacts;
}

export interface SshModeDeps {
  isInteractiveTerminal: () => boolean;
  prepareSession: (handle: SandboxHandle) => Promise<SshBridgeSession>;
  runInteractiveSession: (session: SshBridgeSession, remoteCommand: string) => Promise<void>;
  cleanupSession: (handle: SandboxHandle, session: SshBridgeSession) => Promise<void>;
}

export async function prepareSshBridgeSession(handle: SandboxHandle): Promise<SshBridgeSession> {
  logger.verbose("SSH bridge: checking/installing dependencies.");
  await handle.run(
    "bash -lc 'command -v sshd >/dev/null 2>&1 && command -v websockify >/dev/null 2>&1 && command -v ssh-keygen >/dev/null 2>&1 || (sudo apt-get update && sudo apt-get install -y openssh-server websockify)'",
    { timeoutMs: SSH_SETUP_TIMEOUT_MS }
  );

  const tempDir = await mkdtemp(join(tmpdir(), "ez-devbox-ssh-"));
  const privateKeyPath = join(tempDir, "id_ed25519");

  logger.verbose("SSH bridge: generating local key pair.");
  await runLocalCommand("ssh-keygen", ["-t", "ed25519", "-N", "", "-f", privateKeyPath, "-q"], SSH_SHORT_TIMEOUT_MS);

  const publicKey = (await readFile(`${privateKeyPath}.pub`, "utf8")).trim();
  if (publicKey === "") {
    throw new Error("Generated SSH public key is empty.");
  }

  const sessionId = basename(tempDir);
  const remoteUserResult = await handle.run("whoami", { timeoutMs: SSH_SHORT_TIMEOUT_MS });
  const remoteUser = remoteUserResult.stdout.trim() || SSH_USER_FALLBACK;
  const remoteHomeResult = await handle.run("bash -lc 'printf %s \"$HOME\"'", { timeoutMs: SSH_SHORT_TIMEOUT_MS });
  const remoteHome = remoteHomeResult.stdout.trim();
  if (remoteHome === "") {
    throw new Error("Failed to resolve remote home directory for SSH bridge session.");
  }
  const sessionDir = `${remoteHome}/.ez-devbox-ssh/${sessionId}`;
  const artifacts = {
    sessionDir,
    authorizedKeysPath: `${sessionDir}/authorized_keys`,
    hostPrivateKeyPath: `${sessionDir}/host-ed25519`,
    hostPublicKeyPath: `${sessionDir}/host-ed25519.pub`,
    sshdConfigPath: `${sessionDir}/sshd_config`,
    sshdPidPath: `${sessionDir}/sshd.pid`,
    websockifyPidPath: `${sessionDir}/websockify.pid`,
    websockifyLogPath: `${sessionDir}/websockify.log`
  } satisfies SshBridgeSessionArtifacts;

  logger.verbose("SSH bridge: configuring remote sshd/websockify.");
  await handle.run(
    `bash -lc 'mkdir -p ${quoteShellArg(`${remoteHome}/.ez-devbox-ssh`)} && chmod 700 ${quoteShellArg(
      `${remoteHome}/.ez-devbox-ssh`
    )} && rm -rf ${quoteShellArg(sessionDir)} && mkdir -p ${quoteShellArg(sessionDir)} && chmod 700 ${quoteShellArg(sessionDir)}'`,
    { timeoutMs: SSH_SHORT_TIMEOUT_MS }
  );

  const publicKeyBase64 = Buffer.from(publicKey, "utf8").toString("base64");

  await handle.run(
    `bash -lc 'printf %s ${publicKeyBase64} | base64 -d > ${quoteShellArg(artifacts.authorizedKeysPath)} && chmod 600 ${quoteShellArg(artifacts.authorizedKeysPath)}'`,
    { timeoutMs: SSH_SHORT_TIMEOUT_MS }
  );

  await handle.run(
    `ssh-keygen -t ed25519 -N "" -f ${quoteShellArg(artifacts.hostPrivateKeyPath)} -q`,
    { timeoutMs: SSH_SHORT_TIMEOUT_MS }
  );

  const hostKeyResult = await handle.run(
    `bash -lc 'cat ${quoteShellArg(artifacts.hostPublicKeyPath)}'`,
    { timeoutMs: SSH_SHORT_TIMEOUT_MS }
  );

  const hostPublicKey = hostKeyResult.stdout.trim();
  if (hostPublicKey === "") {
    throw new Error("Failed to load SSH host public key.");
  }

  const knownHostsPath = join(tempDir, "known_hosts");
  const knownHostEntry = `${SSH_HOST} ${hostPublicKey}\n`;
  await writeFile(knownHostsPath, knownHostEntry);
  await chmod(knownHostsPath, 0o600);

  await handle.run(
    `bash -lc 'cat > ${quoteShellArg(artifacts.sshdConfigPath)} <<"EOF"\n${buildSshdConfig(
      artifacts
    )}\nEOF'`,
    { timeoutMs: SSH_SHORT_TIMEOUT_MS }
  );

  await handle.run("sudo mkdir -p /run/sshd", { timeoutMs: SSH_SHORT_TIMEOUT_MS });
  await handle.run(`sudo /usr/sbin/sshd -f ${quoteShellArg(artifacts.sshdConfigPath)}`, { timeoutMs: SSH_SHORT_TIMEOUT_MS });
  await handle.run(
    `nohup websockify 0.0.0.0:${WEBSOCKIFY_PORT} 127.0.0.1:${SSHD_PORT} >${quoteShellArg(
      artifacts.websockifyLogPath
    )} 2>&1 & echo $! > ${quoteShellArg(artifacts.websockifyPidPath)}`,
    { timeoutMs: SSH_SHORT_TIMEOUT_MS }
  );

  const wsUrl = toWsUrl(await handle.getHost(WEBSOCKIFY_PORT));
  logger.verbose(`SSH bridge ready: ${wsUrl}`);

  return {
    tempDir,
    privateKeyPath,
    knownHostsPath,
    wsUrl,
    remoteUser,
    artifacts
  };
}

export function buildSshClientArgs(session: SshBridgeSession, remoteCommand: string): string[] {
  const proxyScriptPath = resolve(process.cwd(), "scripts/ws-ssh-proxy.mjs");
  const proxyCommand = `node ${quoteShellArg(proxyScriptPath)} ${quoteShellArg(session.wsUrl)}`;

  const sshUser = session.remoteUser?.trim() || SSH_USER_FALLBACK;

  return [
    "-tt",
    "-o",
    "BatchMode=yes",
    "-o",
    "PasswordAuthentication=no",
    "-o",
    "KbdInteractiveAuthentication=no",
    "-o",
    "ChallengeResponseAuthentication=no",
    "-o",
    "PubkeyAuthentication=yes",
    "-o",
    "IdentitiesOnly=yes",
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    `UserKnownHostsFile=${quoteShellArg(session.knownHostsPath)}`,
    "-o",
    "LogLevel=ERROR",
    "-o",
    `ProxyCommand=${proxyCommand}`,
    "-i",
    session.privateKeyPath,
    `${sshUser}@${SSH_HOST}`,
    remoteCommand
  ];
}

export async function runInteractiveSshSession(session: SshBridgeSession, remoteCommand: string): Promise<void> {
  const sshArgs = buildSshClientArgs(session, remoteCommand);

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn("ssh", sshArgs, {
      stdio: "inherit"
    });

    child.once("error", (error) => {
      rejectPromise(new Error(`Failed to start local ssh client for interactive SSH attach: ${error.message}`));
    });

    child.once("exit", (code, signal) => {
      if (signal) {
        rejectPromise(new Error(`Interactive SSH session terminated by signal '${signal}'.`));
        return;
      }

      if (code !== 0) {
        rejectPromise(new Error(`Interactive SSH session exited with status ${code}.`));
        return;
      }

      resolvePromise();
    });
  });
}

export async function cleanupSshBridgeSession(handle: SandboxHandle, session: SshBridgeSession): Promise<void> {
  const artifacts = session.artifacts;

  if (artifacts) {
    const removePaths = [
      artifacts.authorizedKeysPath,
      artifacts.hostPrivateKeyPath,
      artifacts.hostPublicKeyPath,
      artifacts.sshdConfigPath,
      artifacts.websockifyLogPath,
      artifacts.websockifyPidPath,
      artifacts.sshdPidPath
    ];

    await runBestEffortRemoteCleanup(
      handle,
      `if [ -f ${quoteShellArg(artifacts.websockifyPidPath)} ]; then pid=$(cat ${quoteShellArg(artifacts.websockifyPidPath)}); if [ -n "$pid" ]; then kill "$pid" >/dev/null 2>&1 || true; fi; fi`
    );
    await runBestEffortRemoteCleanup(
      handle,
      `if [ -f ${quoteShellArg(artifacts.sshdPidPath)} ]; then pid=$(cat ${quoteShellArg(artifacts.sshdPidPath)}); if [ -n "$pid" ]; then sudo kill "$pid" >/dev/null 2>&1 || true; fi; fi`
    );
    await runBestEffortRemoteCleanup(
      handle,
      `for path in ${removePaths.map(quoteShellArg).join(" ")} ; do rm -f "$path"; done; rm -rf ${quoteShellArg(artifacts.sessionDir)}`
    );
  }

  await runBestEffortLocalCleanup(session.tempDir);
}

async function runBestEffortRemoteCleanup(handle: SandboxHandle, command: string): Promise<void> {
  try {
    await handle.run(command, { timeoutMs: SSH_SHORT_TIMEOUT_MS });
  } catch {
    // Ignore cleanup failures.
  }
}

function buildSshdConfig(artifacts: SshBridgeSessionArtifacts): string {
  return [
    `Port ${SSHD_PORT}`,
    "ListenAddress 0.0.0.0",
    "HostKeyAlgorithms ssh-ed25519",
    `HostKey ${artifacts.hostPrivateKeyPath}`,
    "PasswordAuthentication no",
    "PermitRootLogin no",
    "PubkeyAuthentication yes",
    "ChallengeResponseAuthentication no",
    "KbdInteractiveAuthentication no",
    `AuthorizedKeysFile ${artifacts.authorizedKeysPath}`,
    `PidFile ${artifacts.sshdPidPath}`,
    "UsePAM no",
    "X11Forwarding no",
    "AllowTcpForwarding no",
    "AllowAgentForwarding no",
    "PermitOpen none",
    "GatewayPorts no",
    "PermitTunnel no",
    "PrintMotd no",
    "Subsystem sftp internal-sftp"
  ].join("\n");
}

function toWsUrl(host: string): string {
  if (host.startsWith("https://")) {
    return host.replace("https://", "wss://");
  }

  if (host.startsWith("http://")) {
    return host.replace("http://", "ws://");
  }

  return `wss://${host}`;
}

function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

async function runBestEffortLocalCleanup(tempDir: string): Promise<void> {
  try {
    await rm(tempDir, {
      recursive: true,
      force: true
    });
  } catch {
    // Ignore cleanup failures.
  }
}

async function runLocalCommand(command: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      command,
      args,
      {
        timeout: timeoutMs,
        encoding: "utf8",
        maxBuffer: 1024 * 1024
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr?.trim() || error.message;
          rejectPromise(new Error(`${command} failed: ${detail}`));
          return;
        }

        resolvePromise({
          stdout: stdout ?? "",
          stderr: stderr ?? ""
        });
      }
    );
  });
}
