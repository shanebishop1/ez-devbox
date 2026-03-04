import { execFile, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { SSH_HOST, SSH_USER_FALLBACK } from "./ssh-bridge.constants.js";
import type { SshBridgeSession, SshBridgeSessionArtifacts } from "./ssh-bridge.types.js";
import { quoteShellArg } from "./ssh-bridge.utils.js";

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
    remoteCommand,
  ];
}

export async function runInteractiveSshSession(session: SshBridgeSession, remoteCommand: string): Promise<void> {
  const sshArgs = buildSshClientArgs(session, remoteCommand);

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn("ssh", sshArgs, {
      stdio: "inherit",
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

export function buildInteractiveRemoteCommand(options: {
  cwd?: string;
  envScriptPath?: string;
  command: string;
}): string {
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

export function buildSshdConfig(artifacts: SshBridgeSessionArtifacts): string {
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
    "Subsystem sftp internal-sftp",
  ].join("\n");
}

export async function runLocalCommand(
  command: string,
  args: string[],
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      command,
      args,
      {
        timeout: timeoutMs,
        encoding: "utf8",
        maxBuffer: 1024 * 1024,
      },
      (error, stdout, stderr) => {
        if (error) {
          const detail = stderr?.trim() || error.message;
          rejectPromise(new Error(`${command} failed: ${detail}`));
          return;
        }

        resolvePromise({
          stdout: stdout ?? "",
          stderr: stderr ?? "",
        });
      },
    );
  });
}

function resolveWsSshProxyScriptPath(): string {
  const candidates = [
    fileURLToPath(new URL("../../scripts/ws-ssh-proxy.mjs", import.meta.url)),
    fileURLToPath(new URL("../../../scripts/ws-ssh-proxy.mjs", import.meta.url)),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  throw new Error(
    "Unable to locate ws-ssh-proxy.mjs. Ensure scripts/ws-ssh-proxy.mjs is included with the ez-devbox package.",
  );
}
