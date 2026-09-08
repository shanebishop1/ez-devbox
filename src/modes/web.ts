import { randomUUID } from "node:crypto";
import type { SandboxHandle } from "../e2b/lifecycle.js";
import type { LaunchContextOptions, ModeLaunchResult } from "./index.js";
import { assertRemoteCommandSucceeded } from "./remote-command.js";

const WEB_READINESS_COMMAND =
  'bash -lc \'for attempt in $(seq 1 30); do status=$(curl --connect-timeout 1 --max-time 1 -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/ || true); if [ "$status" = "200" ] || [ "$status" = "401" ]; then exit 0; fi; sleep 1; done; exit 1\'';
const WEB_AUTH_PROBE_COMMAND =
  "bash -lc 'curl --connect-timeout 2 --max-time 3 -s -o /dev/null -w \"%{http_code}\" http://127.0.0.1:3000/ || true'";
const WEB_START_TIMEOUT_MS = 10_000;
const WEB_READY_TIMEOUT_MS = 60_000;
const WEB_AUTH_TIMEOUT_MS = 10_000;
const WEB_CLEANUP_TIMEOUT_MS = 5_000;
const WEB_OWNER_ENV_VAR = "EZ_DEVBOX_WEB_OWNER";
const STARTED_MARKER = "ez-devbox-web:started:";
const EXISTING_AUTHENTICATED_MARKER = "ez-devbox-web:existing-authenticated";
const EXISTING_UNSAFE_MARKER = "ez-devbox-web:existing-unsafe:";
const PASSWORD_REQUIRED_MARKER = "ez-devbox-web:password-required";
const PROBE_FAILED_MARKER = "ez-devbox-web:probe-failed";
const CLEANUP_STOPPED_MARKER = "ez-devbox-web-cleanup:stopped";
const CLEANUP_NOT_RUNNING_MARKER = "ez-devbox-web-cleanup:not-running";
const CLEANUP_NOT_OWNED_MARKER = "ez-devbox-web-cleanup:not-owned";

interface WebCommandContext {
  cwd?: string;
  envs: Record<string, string>;
}

type CleanupOutcome = "stopped" | "not-running" | "not-owned" | "failed";

export async function startWebMode(
  handle: SandboxHandle,
  launchContext: LaunchContextOptions = {},
): Promise<ModeLaunchResult> {
  if (launchContext.prompt) {
    throw new Error("Prompt input is not supported in web mode; open the returned URL and use the OpenCode interface.");
  }

  const commandContext: WebCommandContext = {
    cwd: normalizeOptionalValue(launchContext.workingDirectory),
    envs: launchContext.startupEnv ?? {},
  };
  const ownerToken = randomUUID();
  const ownedCommandContext = {
    ...commandContext,
    envs: { ...commandContext.envs, [WEB_OWNER_ENV_VAR]: ownerToken },
  };
  const startResult = await runWebCommand(handle, buildWebStartCommand(), ownedCommandContext, WEB_START_TIMEOUT_MS);
  assertRemoteCommandSucceeded(startResult, "Web mode server start");

  const startOutput = startResult.stdout.trim().split(/\r?\n/).at(-1) ?? "";
  if (startOutput === EXISTING_AUTHENTICATED_MARKER) {
    return await buildWebModeResult(handle, "reused");
  }
  if (startOutput.startsWith(EXISTING_UNSAFE_MARKER)) {
    throw existingUnsafeListenerError(startOutput.slice(EXISTING_UNSAFE_MARKER.length));
  }
  if (startOutput === PASSWORD_REQUIRED_MARKER) {
    throw missingPasswordError();
  }
  if (startOutput === PROBE_FAILED_MARKER) {
    throw new Error("Web mode could not check port 3000 safely; verify curl is installed in the sandbox and retry.");
  }

  const startedPid = parseStartedPid(startOutput);
  if (startedPid === undefined) {
    throw new Error("Web mode server start did not report an owned process; refusing to manage an unknown listener.");
  }

  try {
    const readinessResult = await runWebCommand(handle, WEB_READINESS_COMMAND, commandContext, WEB_READY_TIMEOUT_MS);
    assertRemoteCommandSucceeded(readinessResult, "Web mode readiness check");

    const authProbe = await runWebCommand(handle, WEB_AUTH_PROBE_COMMAND, commandContext, WEB_AUTH_TIMEOUT_MS);
    assertRemoteCommandSucceeded(authProbe, "Web mode authentication probe");
    if (parseStatusCode(authProbe.stdout) !== 401) {
      throw new Error("Web mode server did not become password-protected. Set OPENCODE_SERVER_PASSWORD and retry.");
    }

    return await buildWebModeResult(handle, "started");
  } catch (error) {
    const cleanupOutcome = await stopOwnedWebServer(handle, startedPid, ownerToken);
    throw errorAfterCleanup(error, cleanupOutcome);
  }
}

async function runWebCommand(
  handle: SandboxHandle,
  command: string,
  commandContext: WebCommandContext,
  timeoutMs: number,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return handle.run(command, {
    ...(commandContext.cwd ? { cwd: commandContext.cwd } : {}),
    ...(Object.keys(commandContext.envs).length > 0 ? { envs: commandContext.envs } : {}),
    timeoutMs,
  });
}

function buildWebStartCommand(): string {
  return `bash -lc 'status=$(curl --connect-timeout 2 --max-time 3 -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/); if [ "$status" = 401 ]; then printf "%s\\n" "${EXISTING_AUTHENTICATED_MARKER}"; exit 0; fi; if [ -z "$status" ]; then printf "%s\\n" "${PROBE_FAILED_MARKER}"; exit 0; fi; if [ "$status" != 000 ]; then printf "%s%s\\n" "${EXISTING_UNSAFE_MARKER}" "$status"; exit 0; fi; if [ -z "\${OPENCODE_SERVER_PASSWORD:-}" ]; then printf "%s\\n" "${PASSWORD_REQUIRED_MARKER}"; exit 0; fi; nohup opencode serve --hostname 0.0.0.0 --port 3000 </dev/null >/tmp/opencode-serve.log 2>&1 & printf "%s%s\\n" "${STARTED_MARKER}" "$!"'`;
}

function parseStartedPid(stdout: string): string | undefined {
  const value = stdout.startsWith(STARTED_MARKER) ? stdout.slice(STARTED_MARKER.length) : "";
  return /^\d+$/.test(value) ? value : undefined;
}

async function stopOwnedWebServer(handle: SandboxHandle, pid: string, ownerToken: string): Promise<CleanupOutcome> {
  try {
    const result = await handle.run(buildWebCleanupCommand(pid), {
      envs: { [WEB_OWNER_ENV_VAR]: ownerToken },
      timeoutMs: WEB_CLEANUP_TIMEOUT_MS,
    });
    if (result.exitCode !== 0) {
      return "failed";
    }

    const output = result.stdout.trim();
    if (output === CLEANUP_STOPPED_MARKER) {
      return "stopped";
    }
    if (output === CLEANUP_NOT_RUNNING_MARKER) {
      return "not-running";
    }
    if (output === CLEANUP_NOT_OWNED_MARKER) {
      return "not-owned";
    }
  } catch {
    return "failed";
  }

  return "failed";
}

function buildWebCleanupCommand(pid: string): string {
  return `bash -lc 'pid="$1"; owner="\${${WEB_OWNER_ENV_VAR}:-}"; if [ -z "$owner" ]; then printf "%s\\n" "ez-devbox-web-cleanup:failed"; exit 0; fi; if ! kill -0 "$pid" 2>/dev/null; then printf "%s\\n" "${CLEANUP_NOT_RUNNING_MARKER}"; exit 0; fi; if [ ! -r "/proc/$pid/environ" ] || ! tr "\\0" "\\n" < "/proc/$pid/environ" 2>/dev/null | grep -Fqx -- "${WEB_OWNER_ENV_VAR}=$owner"; then printf "%s\\n" "${CLEANUP_NOT_OWNED_MARKER}"; exit 0; fi; kill "$pid" 2>/dev/null || { printf "%s\\n" "ez-devbox-web-cleanup:failed"; exit 0; }; for attempt in $(seq 1 20); do if ! kill -0 "$pid" 2>/dev/null; then printf "%s\\n" "${CLEANUP_STOPPED_MARKER}"; exit 0; fi; sleep 0.1; done; printf "%s\\n" "ez-devbox-web-cleanup:failed"' -- '${pid}'`;
}

function existingUnsafeListenerError(status: string): Error {
  if (status === "200") {
    return new Error(
      "Web mode found an existing unauthenticated listener on port 3000. Refusing to reuse or stop it. Stop that listener yourself or use another sandbox, then retry.",
    );
  }

  return new Error(
    `Web mode found an existing listener on port 3000 that returned HTTP ${status || "unknown"} instead of requiring authentication. Refusing to reuse or stop it. Stop that listener yourself or use another sandbox, then retry.`,
  );
}

function missingPasswordError(): Error {
  return new Error(
    "Web mode requires a nonempty OPENCODE_SERVER_PASSWORD in the sandbox environment before starting a public listener. Set it in .env or your shell environment so ez-devbox can pass it to web mode, or configure it in the sandbox environment, then retry.",
  );
}

function errorAfterCleanup(error: unknown, outcome: CleanupOutcome): Error {
  const rawMessage = error instanceof Error ? error.message : "Web mode startup failed.";
  const message = /[.!?]$/.test(rawMessage) ? rawMessage : `${rawMessage}.`;
  const cleanupMessage =
    outcome === "stopped"
      ? "The listener process owned by this invocation was stopped."
      : outcome === "not-running"
        ? "The owned listener process was already no longer running."
        : outcome === "not-owned"
          ? "Cleanup refused to stop the process because ownership could not be verified; inspect port 3000 in the sandbox before retrying."
          : "Cleanup could not confirm that the owned listener stopped; inspect port 3000 in the sandbox before retrying.";

  return new Error(`${message} ${cleanupMessage}`, { cause: error });
}

async function buildWebModeResult(handle: SandboxHandle, action: "started" | "reused"): Promise<ModeLaunchResult> {
  const host = await handle.getHost(3000);
  const url = ensureHttps(host);

  return {
    mode: "web",
    command: buildWebStartCommand(),
    url,
    readiness: "ready",
    attachment: "not-applicable",
    connection: { type: "http", endpoint: url },
    details: {
      smoke: "opencode-web",
      status: "ready",
      port: 3000,
      authRequired: true,
      authStatus: 401,
    },
    message: `${action === "started" ? "Started" : "Reused"} web mode in sandbox ${handle.sandboxId} at ${url}`,
  };
}

function normalizeOptionalValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}

function ensureHttps(host: string): string {
  if (host.startsWith("http://") || host.startsWith("https://")) {
    return host;
  }

  return `https://${host}`;
}

function parseStatusCode(value: string): number | undefined {
  const trimmed = value.trim();
  if (trimmed === "") {
    return undefined;
  }

  const numeric = Number(trimmed);
  if (!Number.isInteger(numeric) || numeric < 100 || numeric > 599) {
    return undefined;
  }

  return numeric;
}
