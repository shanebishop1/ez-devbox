import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock("node:child_process", () => {
  return {
    spawn: spawnMock
  };
});

import { withConfiguredTunnel } from "../src/tunnel/cloudflared.js";

describe("withConfiguredTunnel", () => {
  afterEach(() => {
    spawnMock.mockReset();
    delete process.env.EZ_DEVBOX_TUNNEL_3002_URL;
    delete process.env.EZ_DEVBOX_TUNNEL_8080_URL;
    delete process.env.EZ_DEVBOX_TUNNELS_JSON;
    delete process.env.EZ_DEVBOX_TUNNEL_PORTS;
    delete process.env.EZ_DEVBOX_TUNNEL_URL;
  });

  it("skips spawning cloudflared when no tunnel ports are configured", async () => {
    const result = await withConfiguredTunnel({ tunnel: { ports: [] } }, async (runtimeEnv) => {
      expect(runtimeEnv).toEqual({});
      return "ok";
    });

    expect(result).toBe("ok");
    expect(spawnMock).not.toHaveBeenCalled();
  });

  it("starts and stops cloudflared around operation", async () => {
    const child = createMockCloudflaredProcess();
    spawnMock.mockReturnValue(child);

    queueMicrotask(() => {
      child.stderr.write("INF | Your quick Tunnel has been created! Visit https://demo.trycloudflare.com\n");
    });

    const result = await withConfiguredTunnel({ tunnel: { ports: [3002] } }, async (runtimeEnv) => {
      expect(runtimeEnv).toEqual({
        EZ_DEVBOX_TUNNEL_3002_URL: "https://demo.trycloudflare.com",
        EZ_DEVBOX_TUNNELS_JSON: "{\"3002\":\"https://demo.trycloudflare.com\"}",
        EZ_DEVBOX_TUNNEL_PORTS: "3002",
        EZ_DEVBOX_TUNNEL_URL: "https://demo.trycloudflare.com"
      });
      expect(process.env.EZ_DEVBOX_TUNNEL_3002_URL).toBe("https://demo.trycloudflare.com");
      expect(process.env.EZ_DEVBOX_TUNNEL_URL).toBe("https://demo.trycloudflare.com");
      return "done";
    });

    expect(result).toBe("done");
    expect(spawnMock).toHaveBeenCalledWith(
      "cloudflared",
      ["tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:3002"],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
    expect(process.env.EZ_DEVBOX_TUNNEL_3002_URL).toBeUndefined();
    expect(process.env.EZ_DEVBOX_TUNNELS_JSON).toBeUndefined();
    expect(process.env.EZ_DEVBOX_TUNNEL_PORTS).toBeUndefined();
    expect(process.env.EZ_DEVBOX_TUNNEL_URL).toBeUndefined();
  });

  it("falls back to Docker when cloudflared binary is missing", async () => {
    const missingBinary = createMockCloudflaredProcess();
    const dockerChild = createMockCloudflaredProcess();
    spawnMock.mockReturnValueOnce(missingBinary).mockReturnValueOnce(dockerChild);

    queueMicrotask(() => {
      missingBinary.emitError(new Error("spawn cloudflared ENOENT"));
      dockerChild.stderr.write("INF | Tunnel URL https://docker.trycloudflare.com\n");
    });

    const result = await withConfiguredTunnel({ tunnel: { ports: [3002] } }, async (runtimeEnv) => {
      expect(runtimeEnv.EZ_DEVBOX_TUNNEL_3002_URL).toBe("https://docker.trycloudflare.com");
      return "ok";
    });

    expect(result).toBe("ok");
    expect(spawnMock).toHaveBeenNthCalledWith(
      1,
      "cloudflared",
      ["tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:3002"],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      "docker",
      expect.arrayContaining([
        "run",
        "--rm",
        "-i",
        "cloudflare/cloudflared:latest",
        "tunnel",
        "--no-autoupdate",
        "--url",
        "http://host.docker.internal:3002"
      ]),
      { stdio: ["ignore", "pipe", "pipe"] }
    );
  });

  it("falls back to Docker when quick tunnel is rate-limited", async () => {
    const localChild = createMockCloudflaredProcess();
    const dockerChild = createMockCloudflaredProcess();
    spawnMock.mockReturnValueOnce(localChild).mockReturnValueOnce(dockerChild);

    queueMicrotask(() => {
      localChild.stderr.write(
        'ERR Error unmarshaling QuickTunnel response: error code: 1015 status_code="429 Too Many Requests"\n'
      );
      localChild.emitExit(1, null);
      dockerChild.stderr.write("INF | Tunnel URL https://docker-rate-limit.trycloudflare.com\n");
    });

    const result = await withConfiguredTunnel({ tunnel: { ports: [3002] } }, async (runtimeEnv) => {
      expect(runtimeEnv.EZ_DEVBOX_TUNNEL_3002_URL).toBe("https://docker-rate-limit.trycloudflare.com");
      return "ok";
    });

    expect(result).toBe("ok");
    expect(spawnMock).toHaveBeenNthCalledWith(
      1,
      "cloudflared",
      ["tunnel", "--no-autoupdate", "--url", "http://127.0.0.1:3002"],
      { stdio: ["ignore", "pipe", "pipe"] }
    );
    expect(spawnMock).toHaveBeenNthCalledWith(
      2,
      "docker",
      expect.arrayContaining([
        "run",
        "--rm",
        "-i",
        "cloudflare/cloudflared:latest",
        "tunnel",
        "--no-autoupdate",
        "--url",
        "http://host.docker.internal:3002"
      ]),
      { stdio: ["ignore", "pipe", "pipe"] }
    );
  });

  it("supports multiple tunnel ports", async () => {
    const first = createMockCloudflaredProcess();
    const second = createMockCloudflaredProcess();
    spawnMock.mockReturnValueOnce(first).mockReturnValueOnce(second);

    queueMicrotask(() => {
      first.stderr.write("INF | Tunnel URL https://first.trycloudflare.com\n");
      second.stderr.write("INF | Tunnel URL https://second.trycloudflare.com\n");
    });

    await withConfiguredTunnel({ tunnel: { ports: [3002, 8080] } }, async (runtimeEnv) => {
      expect(runtimeEnv.EZ_DEVBOX_TUNNEL_3002_URL).toBe("https://first.trycloudflare.com");
      expect(runtimeEnv.EZ_DEVBOX_TUNNEL_8080_URL).toBe("https://second.trycloudflare.com");
      expect(runtimeEnv.EZ_DEVBOX_TUNNEL_PORTS).toBe("3002,8080");
      expect(runtimeEnv.EZ_DEVBOX_TUNNEL_URL).toBeUndefined();
    });

    expect(first.kill).toHaveBeenCalledWith("SIGTERM");
    expect(second.kill).toHaveBeenCalledWith("SIGTERM");
  });
});

function createMockCloudflaredProcess(): {
  stdout: PassThrough;
  stderr: PassThrough;
  kill: ReturnType<typeof vi.fn>;
  exitCode: number | null;
  emitError: (error: Error) => void;
  emitExit: (code: number | null, signal: NodeJS.Signals | null) => void;
  on: (eventName: string, listener: (...args: unknown[]) => void) => EventEmitter;
  once: (eventName: string, listener: (...args: unknown[]) => void) => EventEmitter;
  off: (eventName: string, listener: (...args: unknown[]) => void) => EventEmitter;
} {
  const emitter = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let exitCode: number | null = null;

  const kill = vi.fn((signal: string) => {
    if (exitCode !== null) {
      return true;
    }

    exitCode = signal === "SIGKILL" ? 137 : 0;
    queueMicrotask(() => {
      emitter.emit("exit", exitCode, null);
    });

    return true;
  });

  return {
    stdout,
    stderr,
    kill,
    emitError(error: Error) {
      queueMicrotask(() => {
        emitter.emit("error", error);
      });
    },
    emitExit(code: number | null, signal: NodeJS.Signals | null) {
      queueMicrotask(() => {
        exitCode = code;
        emitter.emit("exit", code, signal);
      });
    },
    get exitCode() {
      return exitCode;
    },
    set exitCode(value: number | null) {
      exitCode = value;
    },
    on(eventName: string, listener: (...args: unknown[]) => void) {
      emitter.on(eventName, listener);
      return emitter;
    },
    once(eventName: string, listener: (...args: unknown[]) => void) {
      emitter.once(eventName, listener);
      return emitter;
    },
    off(eventName: string, listener: (...args: unknown[]) => void) {
      emitter.off(eventName, listener);
      return emitter;
    }
  };
}
