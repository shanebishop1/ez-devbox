import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { config as loadDotEnv } from "dotenv";
import { loadConfig } from "../src/config/load.js";
import type { ResolvedLauncherConfig } from "../src/config/schema.js";
import { connectSandbox, createSandbox, killSandbox, listSandboxes, type SandboxHandle } from "../src/e2b/lifecycle.js";
import { startShellMode } from "../src/modes/shell.js";
import { runLocalCommand } from "../src/modes/ssh-bridge.commands.js";
import {
  buildInteractiveRemoteCommand,
  buildSshClientArgs,
  cleanupSshBridgeSession,
  prepareSshBridgeSession,
  type SshBridgeSession,
  type SshModeDeps,
} from "../src/modes/ssh-bridge.js";
import { quoteShellArg } from "../src/modes/ssh-bridge.utils.js";
import { redactSensitiveText } from "../src/security/redaction.js";

const RUNS = 3;
const TIMEOUT_MS = 10 * 60 * 1000;
const SMOKE = "EZ_DEVBOX_BENCHMARK_SSH_OK";
const ENV_MARKER = "EZ_DEVBOX_BENCHMARK_MARKER";
const TMUX = "ez-devbox-shell";
type Label = "baseline" | "optimized";
type Phase = "first-launch" | "first-launch-teardown" | "resume-launch" | "resume-launch-teardown";
type Category =
  | "dependency-check"
  | "dependency-install"
  | "tmux-session"
  | "startup-env-staging"
  | "ssh-bridge-setup"
  | "ssh-bridge-cleanup"
  | "remote-command";
type Launch = { spinnerMs?: number; smokeMs?: number };
type Op = { phase: Phase; category: Category; durationMs: number; succeeded: boolean };
type Measurement = {
  run: number;
  status: "PASS" | "FAIL";
  sandboxId?: string;
  error?: string;
  timings: {
    createMs?: number;
    firstLaunch: Launch;
    connectMs?: number;
    resumeLaunch: Launch;
    createToReadyMs?: number;
    resumeToReadyMs?: number;
  };
  operations: {
    runCallCount: number;
    teardownRunCallCount: number;
    dependencyInstallPerformed: boolean;
    timings: Op[];
  };
  cleanup?: Cleanup;
};
type Cleanup = { sandboxId: string; killed: boolean; absent: boolean; error?: string };
type State = { phase: Phase; operations: Op[] };

async function main(): Promise<number> {
  const context = { owned: new Set<string>(), stop: false };
  installSignals(context);
  const report: Record<string, unknown> = {
    label: "baseline",
    runsRequested: RUNS,
    timeoutMs: TIMEOUT_MS,
    measurements: [],
    cleanup: [],
    cleanupFailed: false,
  };
  let exitCode = 0;
  try {
    const args = parseArgs(process.argv.slice(2));
    report.label = args.label;
    report.runsRequested = args.runs;
    loadDotEnv({ quiet: true });
    const config = await loadConfig();
    report.template = config.sandbox.template;
    const sandboxConfig = { sandbox: { ...config.sandbox, timeout_ms: TIMEOUT_MS } } satisfies Pick<
      ResolvedLauncherConfig,
      "sandbox"
    >;
    const measurements: Measurement[] = [];
    for (let run = 1; run <= args.runs && !context.stop; run += 1) {
      measurements.push(await runCycle(sandboxConfig, args.label, run, context));
    }
    report.measurements = measurements;
    report.summary = summarize(measurements);
    report.cleanup = measurements.flatMap((measurement) => (measurement.cleanup ? [measurement.cleanup] : []));
    report.cleanupFailed = measurements.some(
      (measurement) => measurement.cleanup && (!measurement.cleanup.killed || !measurement.cleanup.absent),
    );
    if (measurements.some((measurement) => measurement.status === "FAIL") || report.cleanupFailed) exitCode = 1;
  } catch (error) {
    report.error = safeError(error);
    exitCode = 1;
  } finally {
    report.remainingOwnedSandboxIds = [...context.owned];
    console.log(JSON.stringify(report, null, 2));
  }
  return context.stop ? 130 : exitCode;
}

async function runCycle(
  config: Pick<ResolvedLauncherConfig, "sandbox">,
  label: Label,
  run: number,
  context: { owned: Set<string> },
): Promise<Measurement> {
  const started = performance.now();
  const state: State = { phase: "first-launch", operations: [] };
  const measurement: Measurement = {
    run,
    status: "PASS",
    timings: { firstLaunch: {}, resumeLaunch: {} },
    operations: {
      runCallCount: 0,
      teardownRunCallCount: 0,
      dependencyInstallPerformed: false,
      timings: state.operations,
    },
  };
  let handle: SandboxHandle | undefined;
  try {
    const createStarted = performance.now();
    handle = await createSandbox(config, {
      requestTimeoutMs: TIMEOUT_MS,
      metadata: { "launcher.benchmark": label, "launcher.benchmark-run": String(run) },
    });
    measurement.sandboxId = handle.sandboxId;
    context.owned.add(handle.sandboxId);
    console.error(`[benchmark] owned sandbox: ${handle.sandboxId}`);
    measurement.timings.createMs = elapsed(createStarted);
    const firstReady = await launchShell(
      instrument(handle, state),
      state,
      measurement.timings.firstLaunch,
      "first-launch",
      run,
    );
    if (firstReady !== undefined) measurement.timings.createToReadyMs = round(firstReady - started);

    const connectStarted = performance.now();
    const reconnected = await connectSandbox(handle.sandboxId, config, { requestTimeoutMs: TIMEOUT_MS });
    measurement.timings.connectMs = elapsed(connectStarted);
    const resumeReady = await launchShell(
      instrument(reconnected, state),
      state,
      measurement.timings.resumeLaunch,
      "resume-launch",
      run,
    );
    if (resumeReady !== undefined) measurement.timings.resumeToReadyMs = round(resumeReady - connectStarted);
  } catch (error) {
    measurement.status = "FAIL";
    measurement.error = safeError(error);
  } finally {
    if (handle) {
      measurement.cleanup = await cleanup(handle.sandboxId, context);
      if (!measurement.cleanup.killed || !measurement.cleanup.absent) {
        measurement.status = "FAIL";
        measurement.error ??= measurement.cleanup.error ?? "Sandbox cleanup failed.";
      }
    }
    measurement.operations.teardownRunCallCount = state.operations.filter((operation) =>
      operation.phase.endsWith("teardown"),
    ).length;
    measurement.operations.runCallCount = state.operations.length - measurement.operations.teardownRunCallCount;
    measurement.operations.dependencyInstallPerformed = state.operations.some(
      (operation) => operation.category === "dependency-install" && operation.succeeded,
    );
  }
  return measurement;
}

async function launchShell(
  handle: SandboxHandle,
  state: State,
  timing: Launch,
  phase: "first-launch" | "resume-launch",
  run: number,
): Promise<number | undefined> {
  const started = performance.now();
  state.phase = phase;
  const marker = `benchmark-${run}-${randomUUID()}`;
  let ready: number | undefined;
  const deps: SshModeDeps = {
    isInteractiveTerminal: () => true,
    prepareSession: prepareSshBridgeSession,
    runInteractiveSession: async (session) => {
      ready = await sshSmoke(session, marker, timing, state);
    },
    cleanupSession: cleanupSshBridgeSession,
  };
  await startShellMode(
    handle,
    { startupEnv: { [ENV_MARKER]: marker }, onBeforeInteractiveSession: () => (timing.spinnerMs = elapsed(started)) },
    deps,
  );
  return ready;
}

async function sshSmoke(session: SshBridgeSession, marker: string, timing: Launch, state: State): Promise<number> {
  if (!session.startupEnvScriptPath) throw new Error("Interactive startup environment was not staged.");
  const validation = [
    `tmux -L ${TMUX} has-session -t ${TMUX}`,
    `test "$${ENV_MARKER}" = ${quoteShellArg(marker)}`,
    `printf ${quoteShellArg(SMOKE)}`,
  ].join(" && ");
  const command = buildInteractiveRemoteCommand({
    envScriptPath: session.startupEnvScriptPath,
    command: `bash -lc ${quoteShellArg(validation)}`,
  });
  const started = performance.now();
  try {
    const result = await runLocalCommand("ssh", buildSshClientArgs(session, command), TIMEOUT_MS);
    if (!result.stdout.includes(SMOKE)) throw new Error("SSH smoke command completed without the expected marker.");
    timing.smokeMs = elapsed(started);
    return performance.now();
  } finally {
    state.phase = state.phase === "resume-launch" ? "resume-launch-teardown" : "first-launch-teardown";
  }
}

function instrument(handle: SandboxHandle, state: State): SandboxHandle {
  return {
    ...handle,
    async run(command, options) {
      const started = performance.now();
      try {
        const result = await handle.run(command, options);
        record(state, command, elapsed(started), result.exitCode === 0);
        return result;
      } catch (error) {
        record(state, command, elapsed(started), false);
        throw error;
      }
    },
  };
}

function record(state: State, command: string, durationMs: number, succeeded: boolean): void {
  state.operations.push({ phase: state.phase, category: categorize(command), durationMs, succeeded });
}

function categorize(command: string): Category {
  if (command.includes("command -v") && (command.includes("READY") || command.includes("MISSING"))) {
    return "dependency-check";
  }
  if (command.includes("openssh-server") && command.includes("websockify")) return "dependency-install";
  if (command.includes("new-session") || command.includes("has-session")) return "tmux-session";
  if (command.includes("run_step")) return "ssh-bridge-setup";
  if (command.includes('kill "$pid"') || command.includes("for path in")) return "ssh-bridge-cleanup";
  if (command.includes("startup-env.sh")) return "startup-env-staging";
  if (
    [".ez-devbox-ssh", "authorized_keys", "sshd_config", "ssh-keygen", "/run/sshd"].some((part) =>
      command.includes(part),
    )
  ) {
    return "ssh-bridge-setup";
  }
  return "remote-command";
}

function summarize(rows: Measurement[]): Record<string, unknown> {
  const passed = rows.filter((row) => row.status === "PASS");
  return {
    successfulRuns: passed.length,
    failedRuns: rows.length - passed.length,
    phaseAveragesMs: {
      createMs: average(passed.map((row) => row.timings.createMs)),
      connectMs: average(passed.map((row) => row.timings.connectMs)),
      createToReadyMs: average(passed.map((row) => row.timings.createToReadyMs)),
      resumeToReadyMs: average(passed.map((row) => row.timings.resumeToReadyMs)),
      firstLaunchSpinnerMs: average(passed.map((row) => row.timings.firstLaunch.spinnerMs)),
      firstLaunchSmokeMs: average(passed.map((row) => row.timings.firstLaunch.smokeMs)),
      resumeLaunchSpinnerMs: average(passed.map((row) => row.timings.resumeLaunch.spinnerMs)),
      resumeLaunchSmokeMs: average(passed.map((row) => row.timings.resumeLaunch.smokeMs)),
    },
    operations: {
      runCallCount: passed.reduce((total, row) => total + row.operations.runCallCount, 0),
      teardownRunCallCount: passed.reduce((total, row) => total + row.operations.teardownRunCallCount, 0),
      dependencyInstalls: passed.filter((row) => row.operations.dependencyInstallPerformed).length,
    },
  };
}

function average(values: Array<number | undefined>): number | undefined {
  const defined = values.filter((value): value is number => value !== undefined);
  return defined.length ? round(defined.reduce((a, b) => a + b, 0) / defined.length) : undefined;
}

async function cleanup(sandboxId: string, context: { owned: Set<string> }): Promise<Cleanup> {
  let killed = false;
  let error: string | undefined;
  try {
    killed = await killSandbox(sandboxId, { requestTimeoutMs: TIMEOUT_MS });
  } catch (cause) {
    error = safeError(cause);
  }
  let absent = false;
  try {
    absent = !(await listSandboxes({ requestTimeoutMs: TIMEOUT_MS })).some(
      (sandbox) => sandbox.sandboxId === sandboxId,
    );
  } catch (cause) {
    error = error ? `${error}; list verification: ${safeError(cause)}` : `list verification: ${safeError(cause)}`;
  }
  if (absent) context.owned.delete(sandboxId);
  return { sandboxId, killed, absent, ...(error ? { error } : {}) };
}

function installSignals(context: { owned: Set<string>; stop: boolean }): void {
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    const handler = () => {
      context.stop = true;
      const ids = [...context.owned];
      console.error(`[benchmark] ${signal} received; owned sandbox IDs: ${ids.length ? ids.join(", ") : "none"}`);
    };
    process.once(signal, handler);
  }
}

function parseArgs(args: string[]): { label: Label; runs: number } {
  let label: Label = "baseline";
  let runs = RUNS;
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--label") {
      const value = args[++index];
      if (value !== "baseline" && value !== "optimized") throw new Error("--label must be baseline or optimized.");
      label = value;
    } else if (args[index] === "--runs") {
      runs = Number(args[++index]);
      if (!Number.isInteger(runs) || runs < 1) throw new Error("--runs must be a positive integer.");
    } else throw new Error(`Unknown benchmark option '${args[index]}'.`);
  }
  return { label, runs };
}

const elapsed = (started: number) => round(performance.now() - started);
const round = (value: number) => Math.round(value * 100) / 100;
const safeError = (error: unknown) => redactSensitiveText(error instanceof Error ? error.message : String(error));

await main().then((exitCode) => {
  process.exitCode = exitCode;
});
