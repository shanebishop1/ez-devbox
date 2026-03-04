import type { ResolvedLauncherConfig } from "../config/schema.js";
import { logger } from "../logging/logger.js";
import { attachLogStream, formatRecentLogs } from "./cloudflared.parse.js";
import {
  isSpawnEnoentError,
  stopCloudflaredProcess,
  stopTunnelSessions,
  toErrorMessage,
} from "./cloudflared.process.js";
import {
  getCloudflaredInstallHint,
  resolveTunnelPorts,
  resolveTunnelUpstreamUrl,
  spawnDockerCloudflared,
  spawnLocalCloudflared,
} from "./cloudflared.spawn.js";
import type { CloudflaredProcess, CloudflaredTunnelSession } from "./cloudflared.types.js";

export { CLOUDFLARED_DOCKER_FALLBACK_IMAGE } from "./cloudflared.spawn.js";

const CLOUDFLARED_START_TIMEOUT_MS = 20_000;
const CLOUDFLARED_DOCKER_START_TIMEOUT_MS = 60_000;
const SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
const RATE_LIMIT_SNIPPETS = ["429 too many requests", "error code: 1015", 'status_code="429'];

export type WithConfiguredTunnel = <T>(
  config: Pick<ResolvedLauncherConfig, "tunnel">,
  operation: (runtimeEnv: Record<string, string>) => Promise<T>,
) => Promise<T>;

export async function withConfiguredTunnel<T>(
  config: Pick<ResolvedLauncherConfig, "tunnel">,
  operation: (runtimeEnv: Record<string, string>) => Promise<T>,
): Promise<T> {
  const activePorts = resolveTunnelPorts(config.tunnel.ports, config.tunnel.targets);

  if (activePorts.length === 0) {
    return operation({});
  }

  const sessions: CloudflaredTunnelSession[] = [];
  try {
    for (const port of activePorts) {
      const upstreamUrl = resolveTunnelUpstreamUrl(port, config.tunnel.targets);
      sessions.push(await startCloudflaredTunnel(port, upstreamUrl));
    }
  } catch (error) {
    await stopTunnelSessions(sessions);
    throw error;
  }

  const runtimeEnv = buildRuntimeEnv(sessions);

  let cleanedUp = false;
  const cleanup = async (): Promise<void> => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    removeSignalHandlers();
    await stopTunnelSessions(sessions);
  };

  const signalHandlers = new Map<NodeJS.Signals, () => void>();
  const processExitHandler = (): void => {
    for (const session of [...sessions].reverse()) {
      void session.stop().catch(() => {
        // Best effort during process shutdown.
      });
    }
  };
  process.once("exit", processExitHandler);

  const removeSignalHandlers = (): void => {
    for (const [signal, handler] of signalHandlers) {
      process.off(signal, handler);
    }
    signalHandlers.clear();
    process.off("exit", processExitHandler);
  };

  for (const signal of SIGNALS) {
    const handler = (): void => {
      void cleanup().finally(() => {
        process.kill(process.pid, signal);
      });
    };
    signalHandlers.set(signal, handler);
    process.once(signal, handler);
  }

  try {
    return await operation(runtimeEnv);
  } finally {
    await cleanup();
  }
}

async function startCloudflaredTunnel(port: number, upstreamUrl: string): Promise<CloudflaredTunnelSession> {
  logger.verbose(`Tunnel: starting for ${upstreamUrl}.`);
  const installHint = getCloudflaredInstallHint();

  let processHandle = spawnLocalCloudflared(upstreamUrl);
  let recentLogs: string[] = [];
  let url: string;

  try {
    url = await waitForTunnelUrl(processHandle, recentLogs, CLOUDFLARED_START_TIMEOUT_MS);
  } catch (error) {
    const shouldFallbackForMissingBinary = isSpawnEnoentError(error, "cloudflared");
    const shouldFallbackForRateLimit = isQuickTunnelRateLimitedError(error);

    if (!shouldFallbackForMissingBinary && !shouldFallbackForRateLimit) {
      throw error;
    }

    if (shouldFallbackForMissingBinary) {
      logger.warn(`Tunnel: local 'cloudflared' not found; trying Docker fallback. Install hint: ${installHint}`);
    } else {
      logger.warn("Tunnel: quick tunnel is rate-limited (HTTP 429/1015); trying Docker fallback.");
    }

    processHandle = spawnDockerCloudflared(upstreamUrl);
    recentLogs = [];

    try {
      url = await waitForTunnelUrl(processHandle, recentLogs, CLOUDFLARED_DOCKER_START_TIMEOUT_MS);
    } catch (dockerError) {
      const detail = toErrorMessage(dockerError);
      throw new Error(
        `Failed to start tunnel with local cloudflared or Docker fallback. Install hint: ${installHint}. Or ensure Docker is available. ${detail}`,
      );
    }
  }

  logger.verbose(`Tunnel: ready at ${url}.`);

  return {
    port,
    url,
    stop: async () => {
      logger.verbose("Tunnel: stopping cloudflared.");
      await stopCloudflaredProcess(processHandle);
    },
  };
}

function isQuickTunnelRateLimitedError(error: unknown): boolean {
  const message = toErrorMessage(error).toLowerCase();
  return RATE_LIMIT_SNIPPETS.some((snippet) => message.includes(snippet));
}

function buildRuntimeEnv(sessions: CloudflaredTunnelSession[]): Record<string, string> {
  const runtimeEnv: Record<string, string> = {};
  const byPort: Record<string, string> = {};

  for (const session of sessions) {
    runtimeEnv[`EZ_DEVBOX_TUNNEL_${session.port}_URL`] = session.url;
    byPort[String(session.port)] = session.url;
  }

  runtimeEnv.EZ_DEVBOX_TUNNELS_JSON = JSON.stringify(byPort);
  runtimeEnv.EZ_DEVBOX_TUNNEL_PORTS = sessions.map((session) => String(session.port)).join(",");
  if (sessions.length === 1) {
    runtimeEnv.EZ_DEVBOX_TUNNEL_URL = sessions[0].url;
  }

  return runtimeEnv;
}

async function waitForTunnelUrl(
  processHandle: CloudflaredProcess,
  recentLogs: string[],
  timeoutMs: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      void stopCloudflaredProcess(processHandle).finally(() => {
        const details = formatRecentLogs(recentLogs);
        reject(new Error(`Timed out waiting for cloudflared tunnel URL.${details}`));
      });
    }, timeoutMs);

    const finishWithError = (message: string): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      void stopCloudflaredProcess(processHandle).finally(() => {
        const details = formatRecentLogs(recentLogs);
        reject(new Error(`${message}${details}`));
      });
    };

    const finishWithUrl = (url: string): void => {
      if (settled) {
        return;
      }

      settled = true;
      clearTimeout(timeout);
      resolve(url);
    };

    processHandle.once("error", (error: Error) => {
      finishWithError(`Failed to start cloudflared: ${error.message}`);
    });

    processHandle.once("exit", (code: number | null, signal: NodeJS.Signals | null) => {
      finishWithError(
        `cloudflared exited before tunnel URL was detected (code=${code === null ? "null" : String(code)}, signal=${signal ?? "none"}).`,
      );
    });

    attachLogStream(processHandle.stdout, recentLogs, finishWithUrl);
    attachLogStream(processHandle.stderr, recentLogs, finishWithUrl);
  });
}
