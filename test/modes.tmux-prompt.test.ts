import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { SandboxHandle } from "../src/e2b/lifecycle.js";
import { sendPromptToTmux, type TmuxConnectionInfo } from "../src/modes/tmux.js";
import { quoteShellArg } from "../src/utils/shell.js";

const execFileAsync = promisify(execFile);
const socketNames: string[] = [];
const tempRoots: string[] = [];
const tmuxIt = process.platform === "win32" ? it.skip : it;

afterEach(async () => {
  await Promise.all(
    socketNames.map((socketName) => execFileAsync("tmux", ["-L", socketName, "kill-server"]).catch(() => undefined)),
  );
  await Promise.all(tempRoots.map((path) => rm(path, { recursive: true, force: true })));
  socketNames.length = 0;
  tempRoots.length = 0;
});

describe("tmux prompt delivery", () => {
  tmuxIt("preserves multiline bytes in one bracketed paste and submits once", async () => {
    const root = await mkdtemp(join(tmpdir(), "ez-devbox-tmux-prompt-"));
    tempRoots.push(root);
    const cacheRoot = join(root, "cache", "ez-devbox");
    const readyPath = join(root, "receiver-ready");
    const capturePath = join(root, "receiver-input");
    const socketName = uniqueName("prompt");
    socketNames.push(socketName);
    const receiver = [
      "const fs = require('node:fs');",
      "const [readyPath, capturePath] = process.argv.slice(1);",
      "process.stdin.setRawMode(true);",
      "process.stdin.resume();",
      "process.stdout.write('\\x1b[?2004h');",
      "fs.writeFileSync(readyPath, 'ready');",
      "const chunks = [];",
      "process.stdin.on('data', (chunk) => { chunks.push(Buffer.from(chunk)); fs.writeFileSync(capturePath, Buffer.concat(chunks)); });",
    ].join(" ");

    const receiverCommand = [process.execPath, "-e", receiver, readyPath, capturePath].map(quoteShellArg).join(" ");
    await execFileAsync("tmux", ["-L", socketName, "new-session", "-d", "-s", "agent", receiverCommand]);
    await waitForFile(readyPath);

    const handle = createLocalHandle(cacheRoot);
    const connection = createConnection(socketName);
    const ordinaryPrompt = "ordinary first\nordinary second\nordinary final";
    const generationPrompt = "generation first\ngeneration second\ngeneration final";

    await sendPromptToTmux(handle, connection, ordinaryPrompt);
    const paneId = await getPaneId(socketName);
    await setRegistration(socketName, paneId, "generation-a", "identity-a");
    await sendPromptToTmux(handle, connection, generationPrompt, {
      expectedRegistration: { generation: "generation-a", identity: "identity-a", paneId },
    });

    const capture = await waitForCapture(capturePath, ordinaryPrompt, generationPrompt);
    const expectedCapture = Buffer.concat([
      Buffer.from(`\x1b[200~${ordinaryPrompt}\x1b[201~\r`),
      Buffer.from(`\x1b[200~${generationPrompt}\x1b[201~\r`),
    ]);
    expect(capture).toEqual(expectedCapture);
    expect(parseBracketedSubmissions(capture)).toEqual([
      { payload: Buffer.from(ordinaryPrompt), submission: Buffer.from("\r") },
      { payload: Buffer.from(generationPrompt), submission: Buffer.from("\r") },
    ]);

    await expect(
      sendPromptToTmux(handle, connection, "stale prompt", {
        expectedRegistration: { generation: "stale-generation", identity: "identity-a", paneId },
      }),
    ).rejects.toThrow("session generation changed");
    await new Promise((resolve) => setTimeout(resolve, 100));
    await expect(readFile(capturePath)).resolves.toEqual(capture);
  });
});

function uniqueName(label: string): string {
  return `ezdb-test-${label}-${process.pid}-${Date.now()}-${socketNames.length}`;
}

function createConnection(socketName: string): TmuxConnectionInfo {
  return {
    type: "tmux",
    socketName,
    sessionName: "agent",
    attachCommand: "",
    captureCommand: "",
    input: "tmux-buffer",
  };
}

function createLocalHandle(cacheRoot: string): SandboxHandle {
  const sandboxCachePath = "/home/user/.cache/ez-devbox";
  return {
    sandboxId: "local-test",
    run: async (command, options) =>
      runShell(
        command.replaceAll(sandboxCachePath, cacheRoot).replaceAll("chown user:user", "chown $(id -u):$(id -g)"),
        options?.cwd,
        options?.envs,
      ),
    writeFile: async (path, data) =>
      writeFile(path.replace(sandboxCachePath, cacheRoot), Buffer.from(data as ArrayBuffer)),
    getHost: async () => "localhost",
    setTimeout: async () => undefined,
    kill: async () => undefined,
  };
}

async function runShell(
  command: string,
  cwd?: string,
  envs?: Record<string, string>,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync("bash", ["-lc", command], {
      ...(cwd ? { cwd } : {}),
      env: { ...process.env, ...envs },
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const result = error as { stdout?: string; stderr?: string; code?: number };
    return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.code ?? 1 };
  }
}

async function getPaneId(socketName: string): Promise<string> {
  const result = await execFileAsync("tmux", ["-L", socketName, "display-message", "-p", "-t", "agent", "#{pane_id}"]);
  return result.stdout.trim();
}

async function setRegistration(
  socketName: string,
  paneId: string,
  generation: string,
  identity: string,
): Promise<void> {
  await execFileAsync("tmux", ["-L", socketName, "set-option", "-t", paneId, "@ez_devbox_generation", generation]);
  await execFileAsync("tmux", ["-L", socketName, "set-option", "-t", paneId, "@ez_devbox_identity", identity]);
}

async function waitForFile(path: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await access(path);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  throw new Error(`Timed out waiting for ${path}.`);
}

async function waitForCapture(path: string, ...prompts: string[]): Promise<Buffer> {
  const expectedLength = prompts.reduce((length, prompt) => length + 6 + prompt.length + 6 + 1, 0);
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      const capture = await readFile(path);
      if (Buffer.byteLength(capture) >= expectedLength) return capture;
    } catch {
      // The receiver has not received the first input chunk yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for tmux receiver input in ${path}.`);
}

function parseBracketedSubmissions(input: Buffer): Array<{ payload: Buffer; submission: Buffer }> {
  const start = Buffer.from("\x1b[200~");
  const end = Buffer.from("\x1b[201~");
  const submissions: Array<{ payload: Buffer; submission: Buffer }> = [];
  let offset = 0;
  while (offset < input.length) {
    const startOffset = input.indexOf(start, offset);
    if (startOffset < 0) break;
    const payloadOffset = startOffset + start.length;
    const endOffset = input.indexOf(end, payloadOffset);
    if (endOffset < 0) break;
    const submission = input.subarray(endOffset + end.length, endOffset + end.length + 1);
    submissions.push({ payload: input.subarray(payloadOffset, endOffset), submission });
    offset = endOffset + end.length + 1;
  }
  return submissions;
}
