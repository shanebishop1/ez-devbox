import { randomUUID } from "node:crypto";
import type { SandboxHandle } from "../e2b/lifecycle.js";
import { assertSandboxPathHasNoSymlinks, prepareSandboxPrivateFile } from "../tooling/host-sandbox-sync.permissions.js";
import { buildArgvCommand, quoteShellArg } from "../utils/shell.js";
import { assertRemoteCommandSucceeded } from "./remote-command.js";
import type { TmuxConnectionInfo } from "./tmux.js";

const TMUX_IO_TIMEOUT_MS = 15_000;
const TMUX_READY_TIMEOUT_MS = 30_000;

export async function hasPersistentTmuxSession(
  handle: SandboxHandle,
  socketName: string,
  sessionName: string,
): Promise<boolean> {
  const tmux = buildArgvCommand(["tmux", "-L", socketName]);
  const target = quoteShellArg(sessionName);
  const script = `if command -v tmux >/dev/null 2>&1 && ${tmux} has-session -t ${target} 2>/dev/null; then printf PRESENT; else printf ABSENT; fi`;
  const result = await handle.run(`bash -lc ${quoteShellArg(script)}`, { timeoutMs: TMUX_IO_TIMEOUT_MS });
  assertRemoteCommandSucceeded(result, "Persistent tmux session inspection");
  return result.stdout.includes("PRESENT");
}

export async function sendPromptToTmux(
  handle: SandboxHandle,
  connection: TmuxConnectionInfo,
  prompt: string,
  options: { expectedRegistration?: { generation: string; identity: string; paneId: string } } = {},
): Promise<void> {
  const promptId = randomUUID();
  const promptPath = `/home/user/.cache/ez-devbox/ez-devbox-prompt-${promptId}.txt`;
  const bufferName = `ez-devbox-prompt-${promptId}`;
  const loadCommand = buildArgvCommand([
    "tmux",
    "-L",
    connection.socketName,
    "load-buffer",
    "-b",
    bufferName,
    promptPath,
  ]);
  const pasteCommand = buildPromptPasteCommand(connection, bufferName, options.expectedRegistration);
  try {
    await assertSandboxPathHasNoSymlinks(handle, promptPath);
    await prepareSandboxPrivateFile(handle, promptPath);
    await handle.writeFile(promptPath, prompt);
    const loadResult = await handle.run(loadCommand, { timeoutMs: TMUX_IO_TIMEOUT_MS });
    assertRemoteCommandSucceeded(loadResult, "Prompt buffer staging");
    const pasteResult = await handle.run(pasteCommand, { timeoutMs: TMUX_IO_TIMEOUT_MS });
    assertRemoteCommandSucceeded(pasteResult, "Prompt delivery");
    if (options.expectedRegistration && pasteResult.stdout.trim() !== "SENT") {
      throw new Error("Prompt delivery refused because the custom-agent session generation changed.");
    }
  } finally {
    await handle
      .run(
        `${buildArgvCommand(["tmux", "-L", connection.socketName, "delete-buffer", "-b", bufferName])} 2>/dev/null || true; ${buildArgvCommand(["rm", "-f", "--", promptPath])}`,
        { timeoutMs: TMUX_IO_TIMEOUT_MS },
      )
      .catch(() => {});
  }
}

function buildPromptPasteCommand(
  connection: TmuxConnectionInfo,
  bufferName: string,
  expected: { generation: string; identity: string; paneId: string } | undefined,
): string {
  if (!expected) {
    return [
      buildArgvCommand([
        "tmux",
        "-L",
        connection.socketName,
        "paste-buffer",
        "-b",
        bufferName,
        "-d",
        "-t",
        connection.sessionName,
      ]),
      buildArgvCommand(["tmux", "-L", connection.socketName, "send-keys", "-t", connection.sessionName, "Enter"]),
    ].join(" && ");
  }

  const condition = `#{&&:#{==:#{@ez_devbox_generation},${expected.generation}},#{==:#{@ez_devbox_identity},${expected.identity}}}`;
  return buildArgvCommand([
    "tmux",
    "-L",
    connection.socketName,
    "if-shell",
    "-t",
    expected.paneId,
    "-F",
    condition,
    `paste-buffer -b ${bufferName} -d -t ${expected.paneId} ; send-keys -t ${expected.paneId} Enter ; display-message -p SENT`,
    "display-message -p NOT_CURRENT",
  ]);
}

export async function waitForPersistentTmuxSessionReady(
  handle: SandboxHandle,
  socketName: string,
  sessionName: string,
  generation: string,
  options: { maxAttempts?: number; intervalSeconds?: number; paneId?: string } = {},
): Promise<"ready" | "missing" | "replaced" | "timeout"> {
  const tmux = buildArgvCommand(["tmux", "-L", socketName]);
  const target = quoteShellArg(options.paneId || sessionName);
  const maxAttempts = options.maxAttempts ?? 500;
  const intervalSeconds = options.intervalSeconds ?? 0.05;
  const script = [
    "attempts=0",
    `while [ "$attempts" -lt ${maxAttempts} ]; do`,
    `  if ! ${tmux} has-session -t ${target} 2>/dev/null; then printf MISSING; exit 0; fi`,
    `  metadata=$(${tmux} display-message -p -t ${target} '#{@ez_devbox_generation}|#{@ez_devbox_startup_state}')`,
    `  IFS='|' read -r current_generation state <<< "$metadata"`,
    `  if [ "$current_generation" != ${quoteShellArg(generation)} ]; then printf REPLACED; exit 0; fi`,
    '  if [ "$state" = ready ]; then printf READY; exit 0; fi',
    "  attempts=$((attempts + 1))",
    `  sleep ${intervalSeconds}`,
    "done",
    "printf TIMEOUT",
  ].join("\n");
  const result = await handle.run(`bash -lc ${quoteShellArg(script)}`, { timeoutMs: TMUX_READY_TIMEOUT_MS });
  assertRemoteCommandSucceeded(result, "Persistent tmux session readiness check");
  const status = result.stdout.trim();
  if (status === "READY") return "ready";
  if (status === "MISSING") return "missing";
  if (status === "REPLACED") return "replaced";
  return "timeout";
}
