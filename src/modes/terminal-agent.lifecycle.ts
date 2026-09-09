import type { SandboxHandle } from "../e2b/lifecycle.js";
import { buildArgvCommand, quoteShellArg } from "../utils/shell.js";
import {
  ensurePersistentTmuxSession,
  stopOwnedPersistentTmuxSession,
  waitForPersistentTmuxSessionReady,
} from "./tmux.js";

interface RegisteredSessionOptions {
  identity: string;
  ownerToken: string;
  generationToken: string;
}

export async function ensureTerminalSession(options: {
  handle: SandboxHandle;
  socketName: string;
  sessionName: string;
  command: string;
  cwd?: string;
  envs: Record<string, string>;
  detachBehavior?: "ctrl-c" | "tmux-default";
  stagedInitialPromptPath?: string;
  registration?: RegisteredSessionOptions;
}): Promise<Awaited<ReturnType<typeof ensurePersistentTmuxSession>>> {
  let ensured: Awaited<ReturnType<typeof ensurePersistentTmuxSession>> | undefined;
  try {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      ensured = await ensurePersistentTmuxSession(options.handle, {
        socketName: options.socketName,
        sessionName: options.sessionName,
        command: options.command,
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(Object.keys(options.envs).length > 0 ? { envs: options.envs } : {}),
        detachBehavior: options.detachBehavior,
        ...(options.registration
          ? {
              registration: {
                identity: options.registration.identity,
                ownerToken: options.registration.ownerToken,
                generationToken: options.registration.generationToken,
              },
            }
          : {}),
      });
      if (!options.registration) {
        return ensured;
      }

      if (!ensured.registeredIdentity || !ensured.registeredPaneId) {
        if (!ensured.created && attempt < 2) {
          continue;
        }
        throw new Error("The existing ssh-custom session did not complete identity registration.");
      }
      assertRegisteredIdentity(ensured.registeredIdentity, options.registration.identity);
      if (ensured.created) {
        await releaseSessionGate(
          options.handle,
          options.socketName,
          ensured.generation,
          options.registration.ownerToken,
          ensured.registeredPaneId,
        );
      }

      const readiness = await waitForPersistentTmuxSessionReady(
        options.handle,
        options.socketName,
        options.sessionName,
        ensured.generation,
        { paneId: ensured.registeredPaneId },
      );
      if ((readiness === "missing" || readiness === "replaced") && !ensured.created && attempt < 2) {
        continue;
      }
      if (readiness !== "ready") {
        throw new Error(
          readiness === "timeout"
            ? "Custom agent did not become ready after its startup gate was released."
            : "Custom agent session ended before the configured executable became ready.",
        );
      }
      if (options.stagedInitialPromptPath && !ensured.created) {
        throw new Error(
          "Cannot apply an initial prompt because the persistent agent session already exists; reconnect with the same prompt input to send a follow-up.",
        );
      }
      return ensured;
    }
    throw new Error("Persistent agent session did not become ready.");
  } catch (error) {
    if (options.registration && ensured?.created) {
      await stopOwnedPersistentTmuxSession(options.handle, options.socketName, options.sessionName, {
        generation: ensured.generation,
        ownerToken: options.registration.ownerToken,
      }).catch(() => {});
    }
    throw error;
  }
}

export function buildSessionReadyGateCommand(
  command: string,
  options: {
    socketName: string;
    sessionName: string;
    ownerToken: string;
    generationToken: string;
    cleanupPath?: string;
    maxAttempts?: number;
    intervalSeconds?: number;
    readinessDelaySeconds?: number;
  },
): string {
  const tmux = buildArgvCommand(["tmux", "-L", options.socketName]);
  const target = quoteShellArg(options.sessionName);
  const owner = quoteShellArg(options.ownerToken);
  const generation = quoteShellArg(options.generationToken);
  const ownershipCondition = `#{&&:#{==:#{@ez_devbox_generation},${options.generationToken}},#{==:#{@ez_devbox_owner},${options.ownerToken}}}`;
  const readinessCondition = `#{&&:${ownershipCondition},#{==:#{@ez_devbox_startup_state},released}}`;
  const maxAttempts = options.maxAttempts ?? 400;
  const intervalSeconds = options.intervalSeconds ?? 0.05;
  const readinessDelaySeconds = options.readinessDelaySeconds ?? 1;
  return `bash -lc ${quoteShellArg(
    [
      "attempts=0",
      ...(options.cleanupPath
        ? [
            `cleanup() { rm -f -- ${quoteShellArg(options.cleanupPath)}; }`,
            "trap cleanup EXIT",
            "trap 'exit 129' HUP",
            "trap 'exit 130' INT",
            "trap 'exit 143' TERM",
          ]
        : []),
      "while :; do",
      `  metadata=$(${tmux} display-message -p -t ${target} '#{@ez_devbox_generation}|#{@ez_devbox_owner}|#{@ez_devbox_startup_gate}|#{@ez_devbox_pane_id}' 2>/dev/null || true)`,
      `  IFS='|' read -r current_generation current_owner gate pane_id <<< "$metadata"`,
      `  if [ -n "$current_generation" ] && [ "$current_generation" != ${generation} ]; then exit 1; fi`,
      `  if [ -n "$current_owner" ] && [ "$current_owner" != ${owner} ]; then exit 1; fi`,
      `  if [ "$current_generation" = ${generation} ] && [ "$current_owner" = ${owner} ] && [ "$gate" = released ] && [ -n "$pane_id" ]; then break; fi`,
      `  if [ "$attempts" -ge ${maxAttempts} ]; then exit 124; fi`,
      "  attempts=$((attempts + 1))",
      `  sleep ${intervalSeconds}`,
      "done",
      `prepared=$(${tmux} if-shell -t "$pane_id" -F ${quoteShellArg(ownershipCondition)} "set-option -t $pane_id @ez_devbox_startup_state released ; set-option -F -t $pane_id @ez_devbox_startup_pid '#{pane_pid}' ; display-message -p PREPARED" 'display-message -p NOT_OWNED')`,
      'if [ "$prepared" != PREPARED ]; then exit 1; fi',
      `pane_pid=$(${tmux} show-options -qv -t "$pane_id" @ez_devbox_startup_pid)`,
      `pane_start=$(cut -d ' ' -f 22 "/proc/$pane_pid/stat")`,
      "(",
      `  sleep ${readinessDelaySeconds}`,
      `  current_start=$(cut -d ' ' -f 22 "/proc/$pane_pid/stat" 2>/dev/null || true)`,
      `  if [ "$current_start" = "$pane_start" ]; then`,
      `    ${tmux} if-shell -t "$pane_id" -F ${quoteShellArg(readinessCondition)} "set-option -t $pane_id @ez_devbox_startup_state ready" '' 2>/dev/null || true`,
      "  fi",
      ") </dev/null >/dev/null 2>&1 &",
      `exec ${command}`,
    ].join("\n"),
  )}`;
}

function assertRegisteredIdentity(actual: string | undefined, expected: string): void {
  if (actual !== expected) {
    throw new Error(
      "An existing ssh-custom session was created with a different agent configuration; reconnect with the original configuration or stop the session before retrying.",
    );
  }
}

async function releaseSessionGate(
  handle: SandboxHandle,
  socketName: string,
  generation: string,
  ownerToken: string,
  paneId: string,
): Promise<void> {
  const condition = `#{&&:#{==:#{@ez_devbox_generation},${generation}},#{==:#{@ez_devbox_owner},${ownerToken}}}`;
  const command = buildArgvCommand([
    "tmux",
    "-L",
    socketName,
    "if-shell",
    "-t",
    paneId,
    "-F",
    condition,
    `set-option -t ${paneId} @ez_devbox_startup_gate released ; display-message -p RELEASED`,
    "display-message -p NOT_OWNED",
  ]);
  const result = await handle.run(command, { timeoutMs: 10_000 });
  if (result.exitCode !== 0) {
    throw new Error("Failed to release the custom-agent session startup gate.");
  }
  if (result.stdout.trim() !== "RELEASED") {
    throw new Error("Failed to release the custom-agent session startup gate because ownership changed.");
  }
}
