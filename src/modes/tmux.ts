import { randomUUID } from "node:crypto";
import type { SandboxHandle } from "../e2b/lifecycle.js";
import { buildArgvCommand, quoteShellArg } from "../utils/shell.js";
import { assertRemoteCommandSucceeded } from "./remote-command.js";

export { hasPersistentTmuxSession, sendPromptToTmux, waitForPersistentTmuxSessionReady } from "./tmux.io.js";

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
  registration?: {
    identity: string;
    ownerToken: string;
    generationToken: string;
  };
}

export interface TmuxSessionOwnership {
  generation: string;
  ownerToken: string;
}

const TMUX_START_TIMEOUT_MS = 120_000;
const TMUX_IO_TIMEOUT_MS = 15_000;
const TMUX_RESULT_PREFIX = "EZ_DEVBOX_TMUX_SESSION";
const TMUX_IDENTITY_OPTION = "@ez_devbox_identity";
const TMUX_GENERATION_OPTION = "@ez_devbox_generation";
const TMUX_OWNER_OPTION = "@ez_devbox_owner";
const TMUX_STARTUP_GATE_OPTION = "@ez_devbox_startup_gate";
const TMUX_STARTUP_STATE_OPTION = "@ez_devbox_startup_state";

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
): Promise<{
  created: boolean;
  connection: TmuxConnectionInfo;
  generation: string;
  registeredIdentity?: string;
  registeredOwnerToken?: string;
  registeredPaneId?: string;
}> {
  const tmux = buildArgvCommand(["tmux", "-L", options.socketName]);
  const target = quoteShellArg(options.sessionName);
  const registration = options.registration;
  const stagingName = `ez-devbox-staging-${randomUUID()}`;
  const stagingTarget = quoteShellArg(stagingName);
  const createCommand = [
    `${tmux} new-session -d -s ${stagingTarget} ${quoteShellArg(options.command)}`,
    `';' set-option -w -t ${stagingTarget} remain-on-exit off`,
    ...(registration
      ? [
          `';' set-option -t ${stagingTarget} ${TMUX_GENERATION_OPTION} ${quoteShellArg(registration.generationToken)}`,
          `';' set-option -t ${stagingTarget} ${TMUX_OWNER_OPTION} ${quoteShellArg(registration.ownerToken)}`,
          `';' set-option -t ${stagingTarget} ${TMUX_IDENTITY_OPTION} ${quoteShellArg(registration.identity)}`,
          `';' set-option -t ${stagingTarget} ${TMUX_STARTUP_STATE_OPTION} waiting`,
          `';' set-option -t ${stagingTarget} ${TMUX_STARTUP_GATE_OPTION} waiting`,
          `';' set-option -F -t ${stagingTarget} @ez_devbox_pane_id '#{pane_id}'`,
        ]
      : []),
    `';' rename-session -t ${stagingTarget} ${target}`,
  ].join(" ");
  const readRegistration = registration
    ? [
        "registered_generation=",
        "registered_identity=",
        "registered_owner=",
        "registered_pane=",
        "attempts=0",
        'while [ "$attempts" -lt 250 ]; do',
        `  if ! metadata=$(${tmux} display-message -p -t ${target} '#{@ez_devbox_generation}|#{@ez_devbox_identity}|#{@ez_devbox_owner}|#{@ez_devbox_pane_id}' 2>/dev/null); then break; fi`,
        `  IFS='|' read -r registered_generation registered_identity registered_owner registered_pane <<< "$metadata"`,
        '  if [ -n "$registered_generation" ] && [ -n "$registered_identity" ] && [ -n "$registered_owner" ] && [ -n "$registered_pane" ]; then break; fi',
        "  attempts=$((attempts + 1))",
        "  sleep 0.05",
        "done",
        'generation="$registered_generation"',
        'if [ -z "$generation" ]; then generation=UNREGISTERED; fi',
      ]
    : ["registered_identity=", "registered_owner=", "registered_pane="];
  const ownershipCondition = registration
    ? `#{&&:#{==:#{${TMUX_GENERATION_OPTION}},${registration.generationToken}},#{==:#{${TMUX_OWNER_OPTION}},${registration.ownerToken}}}`
    : undefined;
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
    "state=EXISTING",
    "generation=",
    "creation_generation=",
    "rollback_created() {",
    '  if [ "$state" != CREATED ]; then return; fi',
    ...(ownershipCondition
      ? [
          `  ${tmux} if-shell -t ${target} -F ${quoteShellArg(ownershipCondition)} ${quoteShellArg(`kill-session -t ${options.sessionName}`)} '' 2>/dev/null || true`,
        ]
      : [
          `  current_generation=$(${tmux} display-message -p -t ${target} '#{session_id}:#{session_created}' 2>/dev/null || true)`,
          '  if [ -n "$creation_generation" ] && [ "$current_generation" = "$creation_generation" ]; then',
          `    ${tmux} kill-session -t ${target} 2>/dev/null || true`,
          "  fi",
        ]),
    "}",
    `if ! ${tmux} has-session -t ${target} 2>/dev/null; then`,
    `  if ${createCommand}; then`,
    "    state=CREATED",
    `    creation_generation=$(${tmux} display-message -p -t ${target} '#{session_id}:#{session_created}')`,
    ...(registration
      ? [`    generation=${quoteShellArg(registration.generationToken)}`]
      : ['    generation="$creation_generation"']),
    ...(registration ? [] : ["    sleep 1"]),
    "  else",
    `    ${tmux} kill-session -t ${stagingTarget} 2>/dev/null || true`,
    `    if ! ${tmux} has-session -t ${target} 2>/dev/null; then exit 1; fi`,
    "  fi",
    "fi",
    'if [ -z "$generation" ]; then',
    `  generation=$(${tmux} display-message -p -t ${target} '#{session_id}:#{session_created}')`,
    "fi",
    ...readRegistration,
    ...(registration
      ? [
          `if [ -z "$registered_generation" ]; then state=EXISTING; printf '\n${TMUX_RESULT_PREFIX}\t%s\t%s\t%s\t%s\t%s\n' "$state" "$generation" "$registered_identity" "$registered_owner" "$registered_pane"; exit 0; fi`,
          `if [ "$state" = CREATED ] && { [ "$registered_generation" != ${quoteShellArg(registration.generationToken)} ] || [ "$registered_owner" != ${quoteShellArg(registration.ownerToken)} ]; }; then state=EXISTING; fi`,
        ]
      : []),
    `if ! ${tmux} set-option -s escape-time 0; then rollback_created; exit 1; fi`,
    `if ! ${tmux} set-option -g default-terminal screen-256color; then rollback_created; exit 1; fi`,
    `if ! ${tmux} set-option -ga terminal-overrides ',xterm-256color:Tc,screen-256color:Tc,tmux-256color:Tc'; then rollback_created; exit 1; fi`,
    `if ! ${tmux} set-option -g status off; then rollback_created; exit 1; fi`,
    ...(options.detachBehavior === "ctrl-c"
      ? [`if ! ${tmux} bind-key -n C-c detach-client; then rollback_created; exit 1; fi`]
      : []),
    `printf '\n${TMUX_RESULT_PREFIX}\t%s\t%s\t%s\t%s\t%s\n' "$state" "$generation" "$registered_identity" "$registered_owner" "$registered_pane"`,
  ].join("\n");
  const result = await handle.run(`bash -lc ${quoteShellArg(script)}`, {
    ...(options.cwd ? { cwd: options.cwd } : {}),
    ...(options.envs && Object.keys(options.envs).length > 0 ? { envs: options.envs } : {}),
    timeoutMs: TMUX_START_TIMEOUT_MS,
  });
  assertRemoteCommandSucceeded(result, "Persistent tmux session startup");
  const parsed = parseTmuxSessionResult(result.stdout);
  return {
    created: parsed.state === "CREATED",
    connection: getTmuxConnection(options.socketName, options.sessionName),
    generation: parsed.generation,
    ...(parsed.registeredIdentity ? { registeredIdentity: parsed.registeredIdentity } : {}),
    ...(parsed.registeredOwnerToken ? { registeredOwnerToken: parsed.registeredOwnerToken } : {}),
    ...(parsed.registeredPaneId ? { registeredPaneId: parsed.registeredPaneId } : {}),
  };
}

export async function stopOwnedPersistentTmuxSession(
  handle: SandboxHandle,
  socketName: string,
  sessionName: string,
  ownership: TmuxSessionOwnership,
): Promise<boolean> {
  const condition = buildOwnershipCondition(ownership);
  const command = buildArgvCommand([
    "tmux",
    "-L",
    socketName,
    "if-shell",
    "-t",
    sessionName,
    "-F",
    condition,
    `kill-session -t ${sessionName}`,
    "display-message -p NOT_OWNED",
  ]);
  const result = await handle.run(command, { timeoutMs: TMUX_IO_TIMEOUT_MS });
  assertRemoteCommandSucceeded(result, "Owned tmux session cleanup");
  return result.stdout.trim() !== "NOT_OWNED";
}

function parseTmuxSessionResult(stdout: string): {
  state: "CREATED" | "EXISTING";
  generation: string;
  registeredIdentity: string;
  registeredOwnerToken: string;
  registeredPaneId: string;
} {
  const resultLine = stdout.split(/\r?\n/).find((line) => line.startsWith(`${TMUX_RESULT_PREFIX}\t`));
  const [, state, generation, registeredIdentity = "", registeredOwnerToken = "", registeredPaneId = ""] =
    resultLine?.split("\t") ?? [];
  if ((state !== "CREATED" && state !== "EXISTING") || !generation) {
    throw new Error("Persistent tmux session startup returned an invalid lifecycle result.");
  }
  return { state, generation, registeredIdentity, registeredOwnerToken, registeredPaneId };
}

export function buildOwnershipCondition(ownership: TmuxSessionOwnership): string {
  return `#{&&:#{==:#{${TMUX_GENERATION_OPTION}},${ownership.generation}},#{==:#{${TMUX_OWNER_OPTION}},${ownership.ownerToken}}}`;
}
