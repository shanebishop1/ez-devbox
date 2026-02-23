import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
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

async function checkSshStatus(handle: {
  run(command: string, opts?: { timeoutMs?: number }): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  getHost(port: number): Promise<string>;
}): Promise<CheckResult> {
  const sshTempDir = await mkdtemp(join(tmpdir(), "agent-box-ssh-"));
  const privateKeyPath = join(sshTempDir, "id_ed25519");

  try {
    await runLocalCommand("ssh-keygen", ["-t", "ed25519", "-N", "", "-f", privateKeyPath, "-q"], 15_000);
    const publicKey = (await readFile(`${privateKeyPath}.pub`, "utf8")).trim();
    if (publicKey === "") {
      throw new Error("generated SSH public key is empty");
    }

    const publicKeyBase64 = Buffer.from(publicKey, "utf8").toString("base64");

    await handle.run("sudo apt-get update && sudo apt-get install -y openssh-server websockify", {
      timeoutMs: 8 * 60 * 1000
    });
    await handle.run("mkdir -p ~/.ssh && chmod 700 ~/.ssh", { timeoutMs: 15_000 });
    await handle.run(`bash -lc 'printf %s ${publicKeyBase64} | base64 -d > ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'`, {
      timeoutMs: 15_000
    });

    await handle.run(
      "bash -lc 'cat > /tmp/sshd_config <<\"EOF\"\nPort 2222\nListenAddress 0.0.0.0\nPasswordAuthentication no\nPermitRootLogin no\nPubkeyAuthentication yes\nAuthorizedKeysFile .ssh/authorized_keys\nPidFile /tmp/sshd.pid\nUsePAM no\nSubsystem sftp internal-sftp\nEOF'",
      { timeoutMs: 15_000 }
    );

    await handle.run("sudo mkdir -p /run/sshd", { timeoutMs: 15_000 });
    await handle.run("sudo /usr/sbin/sshd -f /tmp/sshd_config", { timeoutMs: 15_000 });
    await handle.run("nohup websockify 0.0.0.0:8081 127.0.0.1:2222 >/tmp/websockify.log 2>&1 &", { timeoutMs: 15_000 });

    const wsUrl = toWsUrl(await handle.getHost(8081));
    const proxyScriptPath = resolve(process.cwd(), "scripts/ws-ssh-proxy.mjs");
    const proxyCommand = `node ${quoteShellArg(proxyScriptPath)} ${quoteShellArg(wsUrl)}`;

    const sshResult = await runLocalCommand(
      "ssh",
      [
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=/dev/null",
        "-o",
        "LogLevel=ERROR",
        "-o",
        `ProxyCommand=${proxyCommand}`,
        "-i",
        privateKeyPath,
        "user@e2b-sandbox",
        "echo ssh-ok"
      ],
      60_000
    );

    if (!sshResult.stdout.includes("ssh-ok")) {
      return {
        name: "ssh connectivity",
        status: "FAIL",
        detail: "ssh command completed but did not return expected marker"
      };
    }

    return {
      name: "ssh connectivity",
      status: "PASS",
      detail: `ssh command succeeded via websocket proxy (${wsUrl})`
    };
  } catch (error) {
    return {
      name: "ssh connectivity",
      status: "FAIL",
      detail: `ssh check failed: ${error instanceof Error ? error.message : "unknown error"}`
    };
  } finally {
    await rm(sshTempDir, { recursive: true, force: true });
  }
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
  return `'${value.replace(/'/g, `"'"'"`)}'`;
}

function runLocalCommand(command: string, args: string[], timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
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

function quoteForShell(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

await main();
