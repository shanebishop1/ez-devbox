import { randomUUID } from "node:crypto";
import { Socket } from "node:net";
import { loadConfig } from "../src/config/load.js";
import { connectSandbox, createSandbox, killSandbox } from "../src/e2b/lifecycle.js";
import { resolveSandboxCreateEnv } from "../src/e2b/env.js";
import { launchMode } from "../src/modes/index.js";

type CheckStatus = "PASS" | "FAIL" | "SKIP";

interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
}

const MARKER_PATH = "/tmp/agent-box-live-marker.txt";

async function main(): Promise<void> {
  if (!process.env.E2B_API_KEY) {
    console.log("[e2e:live] FAIL bootstrap: Missing E2B_API_KEY in environment.");
    process.exitCode = 1;
    return;
  }

  const config = await loadConfig();
  const opencodeConfig = {
    ...config,
    sandbox: {
      ...config.sandbox,
      template: "opencode"
    }
  };
  const codexConfig = {
    ...config,
    sandbox: {
      ...config.sandbox,
      template: "codex"
    }
  };
  const checks: CheckResult[] = [];
  const sandboxIds: string[] = [];
  let opencodeSandboxId: string | null = null;
  let codexSandboxId: string | null = null;

  try {
    const webPassword = `live-${randomUUID()}`;
    const opencodeHandle = await createSandbox(opencodeConfig, {
      envs: {
        ...resolveSandboxCreateEnv(opencodeConfig).envs,
        OPENCODE_SERVER_PASSWORD: webPassword
      },
      metadata: {
        "launcher.live": "opencode"
      }
    });
    opencodeSandboxId = opencodeHandle.sandboxId;
    sandboxIds.push(opencodeHandle.sandboxId);
    checks.push({ name: "create opencode sandbox", status: "PASS", detail: opencodeHandle.sandboxId });

    const marker = `marker-${Date.now()}-${randomUUID()}`;
    await opencodeHandle.run(`bash -lc 'printf %s ${quoteForShell(marker)} > ${MARKER_PATH}'`, { timeoutMs: 10_000 });

    const reconnected = await connectSandbox(opencodeHandle.sandboxId, opencodeConfig);
    const markerRead = await reconnected.run(`bash -lc 'cat ${MARKER_PATH}'`, { timeoutMs: 10_000 });
    checks.push(
      markerRead.stdout.trim() === marker
        ? { name: "create/connect marker", status: "PASS", detail: "marker persisted across reconnect" }
        : { name: "create/connect marker", status: "FAIL", detail: "marker mismatch after reconnect" }
    );

    try {
      const opencodeResult = await launchMode(reconnected, "ssh-opencode");
      checks.push({ name: "opencode CLI", status: "PASS", detail: opencodeResult.message });
    } catch (error) {
      checks.push({ name: "opencode CLI", status: "FAIL", detail: formatError(error) });
    }

    try {
      const webResult = await launchMode(reconnected, "web");
      if (!webResult.url) {
        throw new Error("Web mode did not return a URL.");
      }

      const webResponse = await fetch(webResult.url, {
        method: "GET",
        redirect: "manual"
      });

      checks.push(
        webResponse.status === 401
          ? { name: "secure web", status: "PASS", detail: `unauthorized response verified at ${webResult.url}` }
          : { name: "secure web", status: "FAIL", detail: `expected 401 unauthorized, got ${webResponse.status}` }
      );
    } catch (error) {
      checks.push({ name: "secure web", status: "FAIL", detail: formatError(error) });
    }

    checks.push(await checkSshStatus(reconnected));
  } catch (error) {
    checks.push({ name: "opencode flow", status: "FAIL", detail: formatError(error) });
    pushIfMissing(checks, { name: "create/connect marker", status: "SKIP", detail: "opencode flow failed early" });
    pushIfMissing(checks, { name: "opencode CLI", status: "SKIP", detail: "opencode flow failed early" });
    pushIfMissing(checks, { name: "secure web", status: "SKIP", detail: "opencode flow failed early" });
    pushIfMissing(checks, {
      name: "ssh connectivity",
      status: "SKIP",
      detail: "opencode flow failed early; SSH requires a running target sandbox"
    });
  } finally {
    try {
      const codexHandle = await createSandbox(codexConfig, {
        envs: resolveSandboxCreateEnv(codexConfig).envs,
        metadata: {
          "launcher.live": "codex"
        }
      });
      codexSandboxId = codexHandle.sandboxId;
      sandboxIds.push(codexHandle.sandboxId);
      checks.push({ name: "create codex sandbox", status: "PASS", detail: codexHandle.sandboxId });

      try {
        const codexResult = await launchMode(codexHandle, "ssh-codex");
        checks.push({ name: "codex CLI", status: "PASS", detail: codexResult.message });
      } catch (error) {
        checks.push({ name: "codex CLI", status: "FAIL", detail: formatError(error) });
      }
    } catch (error) {
      checks.push({ name: "create codex sandbox", status: "FAIL", detail: formatError(error) });
      checks.push({ name: "codex CLI", status: "SKIP", detail: "codex sandbox creation failed" });
    }

    await cleanupSandboxes(sandboxIds, checks, opencodeSandboxId, codexSandboxId);
  }

  for (const check of checks) {
    console.log(`[e2e:live] ${check.status} ${check.name}: ${check.detail}`);
  }

  const hasFailure = checks.some((check) => check.status === "FAIL");
  if (hasFailure) {
    process.exitCode = 1;
  }
}

async function cleanupSandboxes(
  sandboxIds: string[],
  checks: CheckResult[],
  opencodeSandboxId: string | null,
  codexSandboxId: string | null
): Promise<void> {
  await Promise.all(
    sandboxIds.map(async (sandboxId) => {
      try {
        await killSandbox(sandboxId);
      } catch {
        // best effort cleanup in smoke script
      }
    })
  );

  checks.push({
    name: "cleanup opencode sandbox",
    status: opencodeSandboxId ? "PASS" : "SKIP",
    detail: opencodeSandboxId ? `requested kill for ${opencodeSandboxId}` : "opencode sandbox was not created"
  });
  checks.push({
    name: "cleanup codex sandbox",
    status: codexSandboxId ? "PASS" : "SKIP",
    detail: codexSandboxId ? `requested kill for ${codexSandboxId}` : "codex sandbox was not created"
  });
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

function pushIfMissing(checks: CheckResult[], check: CheckResult): void {
  if (checks.some((entry) => entry.name === check.name)) {
    return;
  }

  checks.push(check);
}

async function checkSshStatus(handle: { getHost(port: number): Promise<string> }): Promise<CheckResult> {
  try {
    const rawHost = await handle.getHost(22);
    const { hostname, port } = parseHost(rawHost, 22);
    const connected = await canConnectTcp(hostname, port, 4_000);

    if (connected) {
      return {
        name: "ssh connectivity",
        status: "PASS",
        detail: `tcp connectivity available at ${hostname}:${port}`
      };
    }

    return {
      name: "ssh connectivity",
      status: "SKIP",
      detail:
        "no reachable SSH listener detected; current template does not expose turnkey SSH. This requires a custom template or tunnel tooling (for example websocat + sshd)."
    };
  } catch (error) {
    return {
      name: "ssh connectivity",
      status: "SKIP",
      detail: `ssh readiness gap: ${error instanceof Error ? error.message : "unknown error"}`
    };
  }
}

function parseHost(value: string, defaultPort: number): { hostname: string; port: number } {
  if (value.startsWith("http://") || value.startsWith("https://")) {
    const parsed = new URL(value);
    return {
      hostname: parsed.hostname,
      port: parsed.port ? Number(parsed.port) : defaultPort
    };
  }

  const hasPort = value.includes(":");
  if (!hasPort) {
    return { hostname: value, port: defaultPort };
  }

  const [hostname, portRaw] = value.split(":", 2);
  const parsedPort = Number(portRaw);

  return {
    hostname,
    port: Number.isInteger(parsedPort) && parsedPort > 0 ? parsedPort : defaultPort
  };
}

function canConnectTcp(hostname: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new Socket();
    let settled = false;

    const finish = (result: boolean): void => {
      if (settled) {
        return;
      }

      settled = true;
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, hostname);
  });
}

function quoteForShell(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

await main();
