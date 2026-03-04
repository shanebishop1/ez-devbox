import { spawn } from "node:child_process";
import type { CloudflaredProcess } from "./cloudflared.types.js";

export const CLOUDFLARED_DOCKER_FALLBACK_IMAGE = "cloudflare/cloudflared:2024.11.0";

export function spawnLocalCloudflared(upstreamUrl: string): CloudflaredProcess {
  return spawn("cloudflared", ["tunnel", "--no-autoupdate", "--url", upstreamUrl], {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function spawnDockerCloudflared(upstreamUrl: string): CloudflaredProcess {
  const args = ["run", "--rm", "-i"];
  if (process.platform === "linux") {
    args.push("--add-host", "host.docker.internal:host-gateway");
  }

  const dockerReachableUrl = toDockerReachableUrl(upstreamUrl);

  args.push(CLOUDFLARED_DOCKER_FALLBACK_IMAGE, "tunnel", "--no-autoupdate", "--url", dockerReachableUrl);

  return spawn("docker", args, {
    stdio: ["ignore", "pipe", "pipe"],
  });
}

export function resolveTunnelUpstreamUrl(port: number, targets?: Record<string, string>): string {
  return targets?.[String(port)] ?? `http://127.0.0.1:${port}`;
}

export function resolveTunnelPorts(ports: number[], targets?: Record<string, string>): number[] {
  if (targets && Object.keys(targets).length > 0) {
    return Object.keys(targets).map((port) => Number.parseInt(port, 10));
  }

  return ports;
}

export function getCloudflaredInstallHint(platform: NodeJS.Platform = process.platform): string {
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

function toDockerReachableUrl(upstreamUrl: string): string {
  let parsed: URL;
  try {
    parsed = new URL(upstreamUrl);
  } catch {
    return upstreamUrl;
  }

  const hostname = parsed.hostname.toLowerCase();
  if (
    hostname !== "127.0.0.1" &&
    hostname !== "localhost" &&
    hostname !== "0.0.0.0" &&
    hostname !== "::1" &&
    hostname !== "[::1]"
  ) {
    return upstreamUrl;
  }

  parsed.hostname = "host.docker.internal";
  return formatUrlWithoutDefaultSlash(parsed);
}

function formatUrlWithoutDefaultSlash(url: URL): string {
  const hasDefaultPath = url.pathname === "/" && url.search === "" && url.hash === "";
  if (!hasDefaultPath) {
    return url.toString();
  }

  return `${url.protocol}//${url.host}`;
}
