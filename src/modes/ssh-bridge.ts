import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, posix } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import type { SandboxHandle } from "../e2b/lifecycle.js";
import { logger } from "../logging/logger.js";

const SSH_SETUP_TIMEOUT_MS = 8 * 60 * 1000;
const SSH_SHORT_TIMEOUT_MS = 15_000;
const SSH_HOST = "e2b-sandbox";
const SSH_USER_FALLBACK = "user";
const SSHD_PORT_MIN = 20000;
const SSHD_PORT_MAX = 45000;
const PORT_ALLOCATION_ATTEMPTS = 96;
const APT_LOCK_RETRY_ATTEMPTS = 24;
const APT_LOCK_RETRY_DELAY_MS = 5_000;

export interface SshBridgeSessionArtifacts {
  sessionDir: string;
  authorizedKeysPath: string;
  hostPrivateKeyPath: string;
  hostPublicKeyPath: string;
  sshdPort: number;
  websockifyPort: number;
  sshdConfigPath: string;
  sshdPidPath: string;
  websockifyPidPath: string;
  websockifyLogPath: string;
}

export interface SshBridgePorts {
  sshdPort: number;
  websockifyPort: number;
}

export interface SshBridgeSession {
  tempDir: string;
  privateKeyPath: string;
  knownHostsPath: string;
  wsUrl: string;
  remoteUser?: string;
  artifacts?: SshBridgeSessionArtifacts;
  startupEnvScriptPath?: string;
}

export interface SshModeDeps {
  isInteractiveTerminal: () => boolean;
  prepareSession: (handle: SandboxHandle) => Promise<SshBridgeSession>;
  runInteractiveSession: (session: SshBridgeSession, remoteCommand: string) => Promise<void>;
  cleanupSession: (handle: SandboxHandle, session: SshBridgeSession) => Promise<void>;
}

const ENV_VAR_NAME_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;

export async function prepareSshBridgeSession(handle: SandboxHandle): Promise<SshBridgeSession> {
  logger.verbose("SSH bridge: checking/installing dependencies.");
  await ensureSshBridgeDependencies(handle);

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
  const ports = await allocateSshBridgePorts(handle, sessionId);
  logger.verbose(`SSH bridge: selected ports sshd=${ports.sshdPort}, websockify=${ports.websockifyPort}.`);
  const artifacts = {
    sessionDir,
    authorizedKeysPath: `${sessionDir}/authorized_keys`,
    hostPrivateKeyPath: `${sessionDir}/host-ed25519`,
    hostPublicKeyPath: `${sessionDir}/host-ed25519.pub`,
    sshdPort: ports.sshdPort,
    websockifyPort: ports.websockifyPort,
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
    `nohup websockify 0.0.0.0:${artifacts.websockifyPort} 127.0.0.1:${artifacts.sshdPort} >${quoteShellArg(
      artifacts.websockifyLogPath
    )} 2>&1 & echo $! > ${quoteShellArg(artifacts.websockifyPidPath)}`,
    { timeoutMs: SSH_SHORT_TIMEOUT_MS }
  );

  const wsUrl = toWsUrl(await handle.getHost(artifacts.websockifyPort));
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

async function ensureSshBridgeDependencies(handle: Pick<SandboxHandle, "run">): Promise<void> {
  if (await hasSshBridgeDependencies(handle)) {
    return;
  }

  logger.verbose("SSH bridge: missing dependencies; installing openssh-server and websockify.");
  const installCommand = "bash -lc 'sudo apt-get update && sudo apt-get install -y openssh-server websockify'";

  for (let attempt = 1; attempt <= APT_LOCK_RETRY_ATTEMPTS; attempt += 1) {
    try {
      await handle.run(installCommand, { timeoutMs: SSH_SETUP_TIMEOUT_MS });
      if (await hasSshBridgeDependencies(handle)) {
        return;
      }
      throw new Error("SSH bridge dependencies remain unavailable after apt-get install.");
    } catch (error) {
      if (!isDpkgLockError(error) || attempt === APT_LOCK_RETRY_ATTEMPTS) {
        throw error;
      }

      logger.verbose(
        `SSH bridge: apt/dpkg lock detected while installing dependencies (attempt ${attempt}/${APT_LOCK_RETRY_ATTEMPTS}); retrying in ${APT_LOCK_RETRY_DELAY_MS}ms.`
      );
      await sleep(APT_LOCK_RETRY_DELAY_MS);
    }
  }
}

async function hasSshBridgeDependencies(handle: Pick<SandboxHandle, "run">): Promise<boolean> {
  const result = await handle.run(
    "bash -lc 'if command -v sshd >/dev/null 2>&1 && command -v websockify >/dev/null 2>&1 && command -v ssh-keygen >/dev/null 2>&1; then printf READY; else printf MISSING; fi'",
    { timeoutMs: SSH_SHORT_TIMEOUT_MS }
  );

  return result.stdout.trim() === "READY";
}

function isDpkgLockError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return (
    message.includes("Could not get lock /var/lib/dpkg/lock-frontend") ||
    message.includes("Unable to acquire the dpkg frontend lock") ||
    message.includes("Could not get lock /var/lib/apt/lists/lock") ||
    message.includes("Unable to lock directory /var/lib/apt/lists")
  );
}

export async function allocateSshBridgePorts(
  handle: Pick<SandboxHandle, "run">,
  sessionId: string,
  attempts = PORT_ALLOCATION_ATTEMPTS
): Promise<SshBridgePorts> {
  const seed = calculateSessionPortSeed(sessionId);
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const sshdPort = candidateSshdPort(seed, attempt);
    const websockifyPort = sshdPort + 1;
    try {
      const result = await handle.run(
        `bash -lc 'sshd_port=${sshdPort}; websockify_port=${websockifyPort}; if (echo >/dev/tcp/127.0.0.1/$sshd_port) >/dev/null 2>&1; then exit 1; fi; if (echo >/dev/tcp/127.0.0.1/$websockify_port) >/dev/null 2>&1; then exit 1; fi; printf "%s %s" "$sshd_port" "$websockify_port"'`,
        { timeoutMs: SSH_SHORT_TIMEOUT_MS }
      );

      const parsed = parseAllocatedPorts(result.stdout);
      if (parsed) {
        return parsed;
      }
    } catch {
      continue;
    }
  }

  throw new Error(`Unable to allocate SSH bridge ports after ${attempts} attempts.`);
}

export function buildSshClientArgs(session: SshBridgeSession, remoteCommand: string): string[] {
  const proxyScriptPath = resolveWsSshProxyScriptPath();
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

function resolveWsSshProxyScriptPath(): string {
  const candidates = [
    fileURLToPath(new URL("../../scripts/ws-ssh-proxy.mjs", import.meta.url)),
    fileURLToPath(new URL("../../../scripts/ws-ssh-proxy.mjs", import.meta.url))
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "Unable to locate ws-ssh-proxy.mjs. Ensure scripts/ws-ssh-proxy.mjs is included with the ez-devbox package."
  );
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

    if (session.startupEnvScriptPath) {
      removePaths.push(session.startupEnvScriptPath);
    }

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

export async function stageInteractiveStartupEnv(
  handle: SandboxHandle,
  session: SshBridgeSession,
  envs: Record<string, string>
): Promise<string | undefined> {
  const validEntries: Array<[string, string]> = [];

  for (const [key, value] of Object.entries(envs)) {
    if (!ENV_VAR_NAME_REGEX.test(key)) {
      logger.warn(`Skipping invalid startup env key for interactive session: ${key}`);
      continue;
    }
    validEntries.push([key, value]);
  }

  if (validEntries.length === 0) {
    return undefined;
  }

  const envScriptPath = resolveStartupEnvScriptPath(handle, session);
  const parentDir = posix.dirname(envScriptPath);
  const keys = validEntries.map(([key]) => quoteShellArg(key)).join(" ");
  const indirectExpansion = "${!key-}";

  await handle.run(
    `bash -lc 'set -euo pipefail; mkdir -p ${quoteShellArg(parentDir)}; umask 077; env_file=${quoteShellArg(
      envScriptPath
    )}; printf "%s\\n" "#!/usr/bin/env bash" > "$env_file"; for key in ${keys}; do value="${indirectExpansion}"; printf "export %s=%q\\n" "$key" "$value" >> "$env_file"; done; chmod 600 "$env_file"'`,
    {
      envs: Object.fromEntries(validEntries),
      timeoutMs: SSH_SHORT_TIMEOUT_MS
    }
  );

  session.startupEnvScriptPath = envScriptPath;
  return envScriptPath;
}

export function buildInteractiveRemoteCommand(options: { cwd?: string; envScriptPath?: string; command: string }): string {
  const steps: string[] = [];

  if (options.cwd) {
    steps.push(`cd ${quoteShellArg(options.cwd)}`);
  }

  if (options.envScriptPath) {
    steps.push(`source ${quoteShellArg(options.envScriptPath)}`);
  }

  steps.push(`exec ${options.command}`);
  return `bash -lc ${quoteShellArg(steps.join(" && "))}`;
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
    `Port ${artifacts.sshdPort}`,
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

function calculateSessionPortSeed(sessionId: string): number {
  let hash = 2166136261;

  for (let index = 0; index < sessionId.length; index += 1) {
    hash ^= sessionId.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }

  return hash;
}

function candidateSshdPort(seed: number, attempt: number): number {
  const range = SSHD_PORT_MAX - SSHD_PORT_MIN;
  return SSHD_PORT_MIN + ((seed + attempt * 7919) % range);
}

function parseAllocatedPorts(stdout: string): SshBridgePorts | null {
  const match = stdout.trim().match(/^(\d+)\s+(\d+)$/);
  if (!match) {
    return null;
  }

  const sshdPort = Number.parseInt(match[1], 10);
  const websockifyPort = Number.parseInt(match[2], 10);
  if (!Number.isInteger(sshdPort) || !Number.isInteger(websockifyPort)) {
    return null;
  }

  return {
    sshdPort,
    websockifyPort
  };
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

function resolveStartupEnvScriptPath(handle: SandboxHandle, session: SshBridgeSession): string {
  if (session.artifacts?.sessionDir) {
    return `${session.artifacts.sessionDir}/startup-env.sh`;
  }

  const random = Math.random().toString(16).slice(2, 10);
  return `/tmp/ez-devbox-startup-env-${handle.sandboxId}-${random}.sh`;
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
