import { spawn, type ChildProcessByStdio } from "node:child_process";
import type { Readable } from "node:stream";
import type { ResolvedLauncherConfig } from "../config/schema.js";
import { logger } from "../logging/logger.js";

const CLOUDFLARED_START_TIMEOUT_MS = 20_000;
const CLOUDFLARED_DOCKER_START_TIMEOUT_MS = 60_000;
const CLOUDFLARED_STOP_TIMEOUT_MS = 5_000;
const SIGNALS: NodeJS.Signals[] = ["SIGINT", "SIGTERM", "SIGHUP"];
const URL_REGEX = /https:\/\/[a-z0-9.-]+/gi;
const RATE_LIMIT_SNIPPETS = ["429 too many requests", "error code: 1015", "status_code=\"429"];

interface CloudflaredTunnelSession {
  port: number;
  url: string;
  stop: () => Promise<void>;
}

type CloudflaredProcess = ChildProcessByStdio<null, Readable, Readable>;

export async function withConfiguredTunnel<T>(
  config: Pick<ResolvedLauncherConfig, "tunnel">,
  operation: (runtimeEnv: Record<string, string>) => Promise<T>
): Promise<T> {
  if (config.tunnel.ports.length === 0) {
    return operation({});
  }

  const sessions: CloudflaredTunnelSession[] = [];
  try {
    for (const port of config.tunnel.ports) {
      sessions.push(await startCloudflaredTunnel(port));
    }
  } catch (error) {
    await stopTunnelSessions(sessions);
    throw error;
  }

  const runtimeEnv = buildRuntimeEnv(sessions);
  const previousEnv = captureExistingEnv(runtimeEnv);
  applyRuntimeEnv(runtimeEnv);

  let cleanedUp = false;
  const cleanup = async (): Promise<void> => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    removeSignalHandlers();
    await stopTunnelSessions(sessions);
    restoreRuntimeEnv(previousEnv);
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

async function startCloudflaredTunnel(port: number): Promise<CloudflaredTunnelSession> {
  logger.verbose(`Tunnel: starting for http://127.0.0.1:${port}.`);
  const installHint = getCloudflaredInstallHint();

  let processHandle = spawnLocalCloudflared(port);
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
      logger.warn(
        `Tunnel: local 'cloudflared' not found; trying Docker fallback. Install hint: ${installHint}`
      );
    } else {
      logger.warn("Tunnel: quick tunnel is rate-limited (HTTP 429/1015); trying Docker fallback.");
    }

    processHandle = spawnDockerCloudflared(port);
    recentLogs = [];

    try {
      url = await waitForTunnelUrl(processHandle, recentLogs, CLOUDFLARED_DOCKER_START_TIMEOUT_MS);
    } catch (dockerError) {
      const detail = toErrorMessage(dockerError);
      throw new Error(
        `Failed to start tunnel with local cloudflared or Docker fallback. Install hint: ${installHint}. Or ensure Docker is available. ${detail}`
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
    }
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

function captureExistingEnv(runtimeEnv: Record<string, string>): Record<string, string | undefined> {
  const previousEnv: Record<string, string | undefined> = {};
  for (const key of Object.keys(runtimeEnv)) {
    previousEnv[key] = process.env[key];
  }

  return previousEnv;
}

function applyRuntimeEnv(runtimeEnv: Record<string, string>): void {
  for (const [key, value] of Object.entries(runtimeEnv)) {
    process.env[key] = value;
  }
}

function restoreRuntimeEnv(previousEnv: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(previousEnv)) {
    restoreProcessEnv(key, value);
  }
}

async function stopTunnelSessions(sessions: CloudflaredTunnelSession[]): Promise<void> {
  const sessionsInReverseOrder = [...sessions].reverse();
  for (const session of sessionsInReverseOrder) {
    await session.stop();
  }
}

async function waitForTunnelUrl(
  processHandle: CloudflaredProcess,
  recentLogs: string[],
  timeoutMs: number
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
        `cloudflared exited before tunnel URL was detected (code=${code === null ? "null" : String(code)}, signal=${signal ?? "none"}).`
      );
    });

    attachLogStream(processHandle.stdout, recentLogs, finishWithUrl);
    attachLogStream(processHandle.stderr, recentLogs, finishWithUrl);
  });
}

function attachLogStream(
  stream: NodeJS.ReadableStream | null,
  recentLogs: string[],
  onUrl: (url: string) => void
): void {
  if (!stream) {
    return;
  }

  stream.setEncoding("utf8");
  let buffer = "";

  stream.on("data", (chunk: string) => {
    buffer += chunk;
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";

    for (const line of lines) {
      pushRecentLog(recentLogs, line);
      const url = extractTunnelUrl(line);
      if (url) {
        onUrl(url);
      }
    }
  });
}

function pushRecentLog(recentLogs: string[], line: string): void {
  const normalized = line.trim();
  if (normalized === "") {
    return;
  }

  recentLogs.push(normalized);
  if (recentLogs.length > 20) {
    recentLogs.shift();
  }
}

function extractTunnelUrl(value: string): string | null {
  const matches = value.match(URL_REGEX);
  if (!matches) {
    return null;
  }

  for (const candidate of matches) {
    if (candidate.includes("localhost") || candidate.includes("127.0.0.1")) {
      continue;
    }

    try {
      const hostname = new URL(candidate).hostname.toLowerCase();
      if (hostname === "trycloudflare.com" || hostname.endsWith(".trycloudflare.com")) {
        return candidate;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function formatRecentLogs(recentLogs: string[]): string {
  if (recentLogs.length === 0) {
    return "";
  }

  return ` Recent cloudflared logs: ${recentLogs.slice(-5).join(" | ")}`;
}

async function stopCloudflaredProcess(processHandle: CloudflaredProcess): Promise<void> {
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

function spawnLocalCloudflared(port: number): CloudflaredProcess {
  return spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", `http://127.0.0.1:${port}`], {
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function spawnDockerCloudflared(port: number): CloudflaredProcess {
  const args = ["run", "--rm", "-i"];
  if (process.platform === "linux") {
    args.push("--add-host", "host.docker.internal:host-gateway");
  }

  args.push(
    "cloudflare/cloudflared:latest",
    "tunnel",
    "--no-autoupdate",
    "--url",
    `http://host.docker.internal:${port}`
  );

  return spawn("docker", args, {
    stdio: ["ignore", "pipe", "pipe"]
  });
}

function isSpawnEnoentError(error: unknown, command: string): boolean {
  return error instanceof Error && error.message.includes(`spawn ${command} ENOENT`);
}

function getCloudflaredInstallHint(platform: NodeJS.Platform = process.platform): string {
  if (platform === "darwin") {
    return "brew install cloudflared";
  }

  if (platform === "win32") {
    return "winget install --id Cloudflare.cloudflared -e";
  }

  if (platform === "linux") {
    return "see Cloudflare docs for your distro: https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/";
  }

  return "install cloudflared from https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/";
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }

  return "unknown error";
}

function restoreProcessEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[key];
    return;
  }

  process.env[key] = value;
}
