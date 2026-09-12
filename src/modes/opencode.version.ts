import { spawnSync } from "node:child_process";
import type { SandboxHandle } from "../e2b/lifecycle.js";
import { logger } from "../logging/logger.js";
import { assertRemoteCommandSucceeded } from "./remote-command.js";

const OPEN_CODE_SMOKE_COMMAND = "opencode --version";
const OPEN_CODE_HEALTH_CHECK_COMMAND =
  'bash -lc \'response=$(curl --connect-timeout 2 --max-time 3 -sS -w "\\nEZ_DEVBOX_OPENCODE_HTTP_STATUS:%{http_code}" http://127.0.0.1:4096/global/health); curl_exit=$?; printf "%s%s\\n%s\\n" "EZ_DEVBOX_OPENCODE_CURL_EXIT:" "$curl_exit" "$response"\'';
const VERSION_CHECK_TIMEOUT_MS = 20_000;
const VERSION_UPGRADE_TIMEOUT_MS = 90_000;
const LOCAL_VERSION_TIMEOUT_MS = 8_000;
const OPEN_CODE_UPGRADE_COMMAND_PREFIX = "opencode upgrade";

export interface OpenCodeBackendInspection {
  state: "absent" | "existing" | "unavailable";
  status?: number;
  version?: string;
}

export async function inspectOpenCodeBackend(
  handle: SandboxHandle,
  commandContext: { cwd?: string; envs: Record<string, string> },
): Promise<OpenCodeBackendInspection> {
  const commandOptions = buildCommandOptions(commandContext);

  try {
    const result = await handle.run(OPEN_CODE_HEALTH_CHECK_COMMAND, {
      ...commandOptions,
      timeoutMs: VERSION_CHECK_TIMEOUT_MS,
    });
    assertRemoteCommandSucceeded(result, "OpenCode backend health check");
    return parseBackendInspection(result.stdout);
  } catch (error) {
    logger.verbose(`Unable to inspect the OpenCode backend: ${toErrorMessage(error)}.`);
    return { state: "unavailable" };
  }
}

export async function inspectAndMaybeMatchNewOpenCodeVersion(
  handle: SandboxHandle,
  commandContext: { cwd?: string; envs: Record<string, string> },
  localVersion: string | undefined,
  onLaunchStageUpdate?: (loadingMessage: string, completionMessage: string) => void,
): Promise<void> {
  if (!localVersion) {
    logger.warn("OpenCode host version is unavailable; starting the sandbox executable without version matching.");
    return;
  }

  const sandboxVersion = await resolveSandboxOpenCodeVersion(handle, commandContext);

  if (!sandboxVersion) {
    logger.warn(`OpenCode version on host: ${localVersion} (sandbox version unavailable).`);
    return;
  }

  logger.info(`OpenCode versions: local=${localVersion}, sandbox=${sandboxVersion}`);

  if (localVersion === sandboxVersion) {
    return;
  }

  onLaunchStageUpdate?.(
    `Launching ssh-opencode: matching OpenCode version (${sandboxVersion} -> ${localVersion})...`,
    "Finished OpenCode version match attempt",
  );
  logger.info(`Attempting to match sandbox OpenCode version to local ${localVersion}.`);

  try {
    const upgradeResult = await handle.run(`${OPEN_CODE_UPGRADE_COMMAND_PREFIX} ${localVersion} -m npm`, {
      ...buildCommandOptions(commandContext),
      timeoutMs: VERSION_UPGRADE_TIMEOUT_MS,
    });
    assertRemoteCommandSucceeded(upgradeResult, "OpenCode version match");
  } catch (error) {
    logger.warn(`OpenCode version match failed before launch: ${toErrorMessage(error)}`);
    return;
  }

  const afterMatchVersion = await resolveSandboxOpenCodeVersion(handle, commandContext);
  if (afterMatchVersion === localVersion) {
    logger.info(`Matched sandbox OpenCode version to local ${localVersion}.`);
    return;
  }

  if (afterMatchVersion) {
    logger.warn(
      `OpenCode version match incomplete: local=${localVersion}, sandbox=${afterMatchVersion}. Template-managed sandbox binary may not be replaceable in this environment.`,
    );
    return;
  }

  logger.warn(
    `OpenCode version match attempted but post-check version is unavailable (local=${localVersion}, sandbox(before)=${sandboxVersion}).`,
  );
}

export async function resolveSandboxOpenCodeVersion(
  handle: SandboxHandle,
  commandContext: { cwd?: string; envs: Record<string, string> },
): Promise<string | undefined> {
  try {
    const currentResult = await handle.run(OPEN_CODE_SMOKE_COMMAND, {
      ...buildCommandOptions(commandContext),
      timeoutMs: VERSION_CHECK_TIMEOUT_MS,
    });
    assertRemoteCommandSucceeded(currentResult, "OpenCode version check");
    return parseSemver(currentResult.stdout);
  } catch (error) {
    logger.verbose(`Unable to read current OpenCode version in sandbox: ${toErrorMessage(error)}.`);
    return undefined;
  }
}

export function reportExistingBackendVersion(
  backend: OpenCodeBackendInspection,
  localVersion: string | undefined,
  clientVersion: string | undefined,
): void {
  if (backend.status !== 200) {
    logger.warn(
      `OpenCode backend is already running and returned HTTP ${backend.status ?? "unknown"}; its version is unavailable, so the active backend will not be upgraded or restarted.`,
    );
    return;
  }

  if (!backend.version) {
    logger.warn(
      "OpenCode backend is already running, but its /global/health version is unavailable; the active backend will not be upgraded or restarted.",
    );
    return;
  }

  if (!localVersion) {
    logger.warn(
      `OpenCode backend is already running at version ${backend.version}; host version is unavailable, so no upgrade was attempted.`,
    );
  } else if (backend.version !== localVersion) {
    logger.warn(
      `OpenCode backend version mismatch: active backend=${backend.version}, local=${localVersion}. Keeping the active backend unchanged; stop the backend deliberately or recreate the sandbox before matching versions.`,
    );
  }

  if (!clientVersion) {
    logger.warn(
      `OpenCode backend is already running at version ${backend.version}, but the sandbox client version is unavailable; client/backend compatibility could not be verified. Stop the backend deliberately or recreate the sandbox before matching versions.`,
    );
    return;
  }

  if (clientVersion !== backend.version) {
    logger.warn(
      `OpenCode client/backend version mismatch: active backend=${backend.version}, sandbox client=${clientVersion}. Keeping the active backend unchanged; stop the backend deliberately or recreate the sandbox before matching versions.`,
    );
  }

  if (clientVersion === backend.version && localVersion === backend.version) {
    logger.info(`OpenCode backend, sandbox client, and local versions match at ${backend.version}.`);
  }
}

export function resolveLocalVersion(resolver: () => string | undefined): string | undefined {
  try {
    return resolver();
  } catch (error) {
    logger.verbose(`Unable to read local OpenCode version: ${toErrorMessage(error)}`);
    return undefined;
  }
}

export function resolveLocalOpenCodeVersion(): string | undefined {
  const result = spawnSync("opencode", ["--version"], {
    encoding: "utf8",
    timeout: LOCAL_VERSION_TIMEOUT_MS,
  });

  if (result.error) {
    logger.verbose(`Unable to read local OpenCode version: ${result.error.message}`);
    return undefined;
  }

  if (result.status !== 0) {
    logger.verbose("Unable to read local OpenCode version: command returned non-zero status.");
    return undefined;
  }

  return parseSemver(result.stdout ?? "");
}

function parseBackendInspection(stdout: string): OpenCodeBackendInspection {
  const marker = "EZ_DEVBOX_OPENCODE_HTTP_STATUS:";
  const curlExitMatch = stdout.match(/^EZ_DEVBOX_OPENCODE_CURL_EXIT:(\d+)\r?\n/);
  if (!curlExitMatch) {
    return { state: "unavailable" };
  }

  const curlExit = Number(curlExitMatch[1]);
  const response = stdout.slice(curlExitMatch[0].length);
  const markerIndex = response.lastIndexOf(marker);
  if (markerIndex < 0) {
    return { state: "unavailable" };
  }

  const status = Number(response.slice(markerIndex + marker.length).trim());
  if (!Number.isInteger(status) || status < 0 || status > 599) {
    return { state: "unavailable" };
  }
  if (curlExit === 7 && status === 0) {
    return { state: "absent", status };
  }
  if (curlExit !== 0 || status === 0) {
    return { state: "unavailable", status };
  }

  const body = response.slice(0, markerIndex).trim();
  return {
    state: "existing",
    status,
    ...(status === 200 ? { version: parseHealthVersion(body) } : {}),
  };
}

function parseHealthVersion(body: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(body);
    if (typeof parsed !== "object" || parsed === null || !("version" in parsed)) {
      return undefined;
    }

    const version = (parsed as { version?: unknown }).version;
    return typeof version === "string" ? parseSemver(version) : undefined;
  } catch {
    return undefined;
  }
}

function buildCommandOptions(commandContext: { cwd?: string; envs: Record<string, string> }): {
  cwd?: string;
  envs?: Record<string, string>;
} {
  return {
    ...(commandContext.cwd ? { cwd: commandContext.cwd } : {}),
    ...(Object.keys(commandContext.envs).length > 0 ? { envs: commandContext.envs } : {}),
  };
}

function parseSemver(value: string): string | undefined {
  const match = value.match(/\b\d+\.\d+\.\d+\b/);
  return match?.[0];
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }

  return "unknown error";
}
