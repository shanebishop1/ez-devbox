import { randomUUID } from "node:crypto";
import type { SandboxHandle } from "../e2b/lifecycle.js";
import { buildArgvCommand, quoteShellArg } from "../utils/shell.js";
import { assertRemoteCommandSucceeded } from "./remote-command.js";

export interface PersistentTmuxCommandOptions {
  socketName: string;
  sessionName: string;
  command: string;
  detachBehavior?: "ctrl-c" | "tmux-default";
}

export interface TmuxConnectionInfo {
  type: "tmux";
  socketName: string;
  sessionName: string;
  attachCommand: string;
  captureCommand: string;
  input: "tmux-buffer";
}

export interface EnsureTmuxSessionOptions extends PersistentTmuxCommandOptions {
  cwd?: string;
  envs?: Record<string, string>;
}

const TMUX_START_TIMEOUT_MS = 120_000;
const TMUX_IO_TIMEOUT_MS = 15_000;

export function buildPersistentTmuxCommand(options: PersistentTmuxCommandOptions): string {
  const parts = [
    `tmux -u -L ${options.socketName}`,
    `new-session -A -s ${options.sessionName} ${quoteShellArg(options.command)}`,
    "\\; set-option -s escape-time 0",
    '\\; set-option -g default-terminal "screen-256color"',
    '\\; set-option -ga terminal-overrides ",xterm-256color:Tc,screen-256color:Tc,tmux-256color:Tc"',
    "\\; set-option -g status off",
  ];

  if (options.detachBehavior === "ctrl-c") {
    parts.push("\\; bind-key -n C-c detach-client");
  }

  return parts.join(" ");
}

export function buildTmuxAttachCommand(socketName: string, sessionName: string): string {
  return buildArgvCommand(["tmux", "-u", "-L", socketName, "attach-session", "-t", sessionName]);
}

export function getTmuxConnection(socketName: string, sessionName: string): TmuxConnectionInfo {
  return {
    type: "tmux",
    socketName,
    sessionName,
    attachCommand: buildTmuxAttachCommand(socketName, sessionName),
    captureCommand: buildArgvCommand(["tmux", "-L", socketName, "capture-pane", "-p", "-S", "-200", "-t", sessionName]),
    input: "tmux-buffer",
  };
}

export async function ensurePersistentTmuxSession(
  handle: SandboxHandle,
  options: EnsureTmuxSessionOptions,
): Promise<{ created: boolean; connection: TmuxConnectionInfo }> {
  const tmux = buildArgvCommand(["tmux", "-L", options.socketName]);
  const target = quoteShellArg(options.sessionName);
  const script = [
    "if ! command -v tmux >/dev/null 2>&1; then",
    "  if command -v apt-get >/dev/null 2>&1; then",
    "    sudo apt-get update >/dev/null && sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y tmux >/dev/null",
    "  elif command -v apk >/dev/null 2>&1; then",
    "    sudo apk add --no-cache tmux >/dev/null",
    "  else",
    "    printf 'tmux is required and no supported package manager was found\\n' >&2; exit 127",
    "  fi",
    "fi",
    `if ${tmux} has-session -t ${target} 2>/dev/null; then`,
    "  printf EXISTING",
    "else",
    `  ${tmux} new-session -d -s ${target} ${quoteShellArg(options.command)}`,
    "  printf CREATED",
    "  sleep 1",
    "fi",
    `${tmux} set-option -s escape-time 0`,
    `${tmux} set-option -g default-terminal screen-256color`,
    `${tmux} set-option -ga terminal-overrides ',xterm-256color:Tc,screen-256color:Tc,tmux-256color:Tc'`,
    `${tmux} set-option -g status off`,
    ...(options.detachBehavior === "ctrl-c" ? [`${tmux} bind-key -n C-c detach-client`] : []),
    `${tmux} has-session -t ${target}`,
  ].join("\n");
  const result = await handle.run(`bash -lc ${quoteShellArg(script)}`, {
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.envs && Object.keys(options.envs).length > 0 ? { envs: options.envs } : {}),
    timeoutMs: TMUX_START_TIMEOUT_MS,
  });
  assertRemoteCommandSucceeded(result, "Persistent tmux session startup");
  return {
    created: result.stdout.includes("CREATED"),
    connection: getTmuxConnection(options.socketName, options.sessionName),
  };
}

export async function sendPromptToTmux(
  handle: SandboxHandle,
  connection: TmuxConnectionInfo,
  prompt: string,
): Promise<void> {
  const promptPath = `/tmp/ez-devbox-prompt-${randomUUID()}.txt`;
  await handle.writeFile(promptPath, prompt);
  const command = [
    buildArgvCommand(["tmux", "-L", connection.socketName, "load-buffer", promptPath]),
    buildArgvCommand(["tmux", "-L", connection.socketName, "paste-buffer", "-d", "-t", connection.sessionName]),
    buildArgvCommand(["tmux", "-L", connection.socketName, "send-keys", "-t", connection.sessionName, "Enter"]),
  ].join(" && ");
  try {
    const result = await handle.run(command, { timeoutMs: TMUX_IO_TIMEOUT_MS });
    assertRemoteCommandSucceeded(result, "Prompt delivery");
  } finally {
    await handle
      .run(buildArgvCommand(["rm", "-f", "--", promptPath]), { timeoutMs: TMUX_IO_TIMEOUT_MS })
      .catch(() => {});
  }
}
