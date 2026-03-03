import type { CloudflaredProcess, CloudflaredTunnelSession } from "./cloudflared.types.js";

const CLOUDFLARED_STOP_TIMEOUT_MS = 5_000;

export async function stopTunnelSessions(sessions: CloudflaredTunnelSession[]): Promise<void> {
  const sessionsInReverseOrder = [...sessions].reverse();
  for (const session of sessionsInReverseOrder) {
    await session.stop();
  }
}

export async function stopCloudflaredProcess(processHandle: CloudflaredProcess): Promise<void> {
  if (processHandle.exitCode !== null) {
    return;
  }

  processHandle.kill("SIGTERM");
  const exitedGracefully = await waitForExit(processHandle, CLOUDFLARED_STOP_TIMEOUT_MS);
  if (exitedGracefully) {
    return;
  }

  processHandle.kill("SIGKILL");
  await waitForExit(processHandle, CLOUDFLARED_STOP_TIMEOUT_MS);
}

export function isSpawnEnoentError(error: unknown, command: string): boolean {
  return error instanceof Error && error.message.includes(`spawn ${command} ENOENT`);
}

export function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }

  return "unknown error";
}

async function waitForExit(processHandle: CloudflaredProcess, timeoutMs: number): Promise<boolean> {
  if (processHandle.exitCode !== null) {
    return true;
  }

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      processHandle.off("exit", onExit);
      resolve(false);
    }, timeoutMs);

    const onExit = (): void => {
      clearTimeout(timeout);
      resolve(true);
    };

    processHandle.once("exit", onExit);
  });
}
