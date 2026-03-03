import type { SandboxHandle } from "../e2b/lifecycle.js";
import { PORT_ALLOCATION_ATTEMPTS, SSH_SHORT_TIMEOUT_MS, SSHD_PORT_MAX, SSHD_PORT_MIN } from "./ssh-bridge.constants.js";
import type { SshBridgePorts } from "./ssh-bridge.types.js";

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
