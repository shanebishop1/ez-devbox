import { execFile, spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { SandboxHandle } from "../e2b/lifecycle.js";
import type { ModeLaunchResult } from "./index.js";

const OPEN_CODE_SMOKE_COMMAND = "opencode --version";
const COMMAND_TIMEOUT_MS = 15_000;
const SSH_SETUP_TIMEOUT_MS = 8 * 60 * 1000;
const SSH_SHORT_TIMEOUT_MS = 15_000;

interface OpenCodeSession {
  tempDir: string;
  privateKeyPath: string;
  wsUrl: string;
}

interface OpenCodeModeDeps {
  isInteractiveTerminal: () => boolean;
  prepareSession: (handle: SandboxHandle) => Promise<OpenCodeSession>;
  runInteractiveSession: (session: OpenCodeSession) => Promise<void>;
  cleanupSession: (session: OpenCodeSession) => Promise<void>;
}

const defaultDeps: OpenCodeModeDeps = {
  isInteractiveTerminal: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
  prepareSession,
  runInteractiveSession,
  cleanupSession
};

export async function startOpenCodeMode(handle: SandboxHandle, deps: OpenCodeModeDeps = defaultDeps): Promise<ModeLaunchResult> {
  if (!deps.isInteractiveTerminal()) {
    return runSmokeCheck(handle);
  }

  const session = await deps.prepareSession(handle);

  try {
    await deps.runInteractiveSession(session);
  } finally {
    await deps.cleanupSession(session);
  }

  return {
    mode: "ssh-opencode",
    command: "opencode",
    details: {
      session: "interactive",
      status: "completed"
    },
    message: `OpenCode interactive session ended for sandbox ${handle.sandboxId}`
  };
}

async function runSmokeCheck(handle: SandboxHandle): Promise<ModeLaunchResult> {
  const result = await handle.run(OPEN_CODE_SMOKE_COMMAND, {
    timeoutMs: COMMAND_TIMEOUT_MS
  });

  const output = firstNonEmptyLine(result.stdout, result.stderr);

  return {
    mode: "ssh-opencode",
    command: OPEN_CODE_SMOKE_COMMAND,
    details: {
      smoke: "opencode-cli",
      status: "ready",
      output
    },
    message: `OpenCode CLI smoke passed in sandbox ${handle.sandboxId}: ${output}. Run from an interactive terminal for full OpenCode session attach.`
  };
}

async function prepareSession(handle: SandboxHandle): Promise<OpenCodeSession> {
  await handle.run("bash -lc 'command -v opencode >/dev/null 2>&1 || exit 127'", {
    timeoutMs: COMMAND_TIMEOUT_MS
  });

  const tempDir = await mkdtemp(join(tmpdir(), "agent-box-opencode-ssh-"));
  const privateKeyPath = join(tempDir, "id_ed25519");

  await runLocalCommand("ssh-keygen", ["-t", "ed25519", "-N", "", "-f", privateKeyPath, "-q"], COMMAND_TIMEOUT_MS);

  const publicKey = (await readFile(`${privateKeyPath}.pub`, "utf8")).trim();
  if (publicKey === "") {
    throw new Error("Failed to generate temporary SSH key for OpenCode attach.");
  }

  const publicKeyBase64 = Buffer.from(publicKey, "utf8").toString("base64");

  await handle.run(
    "bash -lc 'command -v sshd >/dev/null 2>&1 && command -v websockify >/dev/null 2>&1 || (sudo apt-get update && sudo apt-get install -y openssh-server websockify)'",
    { timeoutMs: SSH_SETUP_TIMEOUT_MS }
  );
  await handle.run("mkdir -p ~/.ssh && chmod 700 ~/.ssh", { timeoutMs: SSH_SHORT_TIMEOUT_MS });
  await handle.run(`bash -lc 'printf %s ${publicKeyBase64} | base64 -d > ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys'`, {
    timeoutMs: SSH_SHORT_TIMEOUT_MS
  });
  await handle.run(
    "bash -lc 'cat > /tmp/sshd_config <<\"EOF\"\nPort 2222\nListenAddress 0.0.0.0\nPasswordAuthentication no\nPermitRootLogin no\nPubkeyAuthentication yes\nAuthorizedKeysFile .ssh/authorized_keys\nPidFile /tmp/sshd.pid\nUsePAM no\nSubsystem sftp internal-sftp\nEOF'",
    { timeoutMs: SSH_SHORT_TIMEOUT_MS }
  );
  await handle.run("sudo mkdir -p /run/sshd", { timeoutMs: SSH_SHORT_TIMEOUT_MS });
  await handle.run("sudo /usr/sbin/sshd -f /tmp/sshd_config", { timeoutMs: SSH_SHORT_TIMEOUT_MS });
  await handle.run("nohup websockify 0.0.0.0:8081 127.0.0.1:2222 >/tmp/websockify.log 2>&1 &", {
    timeoutMs: SSH_SHORT_TIMEOUT_MS
  });

  const wsUrl = toWsUrl(await handle.getHost(8081));

  return {
    tempDir,
    privateKeyPath,
    wsUrl
  };
}

async function runInteractiveSession(session: OpenCodeSession): Promise<void> {
  const proxyScriptPath = resolve(process.cwd(), "scripts/ws-ssh-proxy.mjs");
  const proxyCommand = `node ${quoteShellArg(proxyScriptPath)} ${quoteShellArg(session.wsUrl)}`;

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn(
      "ssh",
      [
        "-tt",
        "-o",
        "StrictHostKeyChecking=no",
        "-o",
        "UserKnownHostsFile=/dev/null",
        "-o",
        "LogLevel=ERROR",
        "-o",
        `ProxyCommand=${proxyCommand}`,
        "-i",
        session.privateKeyPath,
        "user@e2b-sandbox",
        "bash -lc 'opencode'"
      ],
      {
        stdio: "inherit"
      }
    );

    child.once("error", (error) => {
      rejectPromise(new Error(`Failed to start local ssh client for OpenCode attach: ${error.message}`));
    });

    child.once("exit", (code, signal) => {
      if (signal) {
        rejectPromise(new Error(`OpenCode SSH session terminated by signal '${signal}'.`));
        return;
      }

      if (code !== 0) {
        rejectPromise(new Error(`OpenCode SSH session exited with status ${code}.`));
        return;
      }

      resolvePromise();
    });
  });
}

async function cleanupSession(session: OpenCodeSession): Promise<void> {
  await rm(session.tempDir, {
    recursive: true,
    force: true
  });
}

function firstNonEmptyLine(stdout: string, stderr: string): string {
  const preferred = stdout.trim() || stderr.trim();
  if (preferred === "") {
    return "no output";
  }

  const [firstLine] = preferred.split("\n");
  return firstLine.trim();
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
