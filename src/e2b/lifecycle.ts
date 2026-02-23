import type { ResolvedLauncherConfig } from "../config/schema.js";
import {
  createE2BClient,
  type E2BClient,
  type E2BClientOptions,
  type E2BSandbox,
  type E2BSandboxSummary,
  type SandboxCommandRunOptions,
  type SandboxCommandRunResult
} from "./client.js";
import { normalizeTimeoutMs } from "./timeout.js";

export interface SandboxHandle {
  sandboxId: string;
  run(command: string, opts?: SandboxCommandRunOptions): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  getHost(port: number): Promise<string>;
  setTimeout(timeoutMs: number): Promise<void>;
  kill(): Promise<void>;
}

export interface LifecycleMetadataTags {
  project?: string;
  mode?: string;
  user?: string;
}

export interface LifecycleOperationOptions extends E2BClientOptions {
  client?: E2BClient;
}

export interface CreateSandboxOptions extends LifecycleOperationOptions {
  metadata?: Record<string, string>;
  tags?: LifecycleMetadataTags;
  envs?: Record<string, string>;
}

export interface ListSandboxesOptions extends LifecycleOperationOptions {
  tags?: LifecycleMetadataTags;
}

export interface SandboxListItem {
  sandboxId: string;
  state: string;
  metadata?: Record<string, string>;
}

type LifecycleConfig = Pick<ResolvedLauncherConfig, "sandbox">;

export class LauncherE2BLifecycleError extends Error {
  readonly cause: unknown;

  constructor(message: string, cause: unknown) {
    super(message);
    this.name = "LauncherE2BLifecycleError";
    this.cause = cause;
  }
}

export function buildMetadataTags(tags?: LifecycleMetadataTags): Record<string, string> {
  const metadata: Record<string, string> = {};

  if (tags?.project) {
    metadata["launcher.project"] = tags.project;
  }

  if (tags?.mode) {
    metadata["launcher.mode"] = tags.mode;
  }

  if (tags?.user) {
    metadata["launcher.user"] = tags.user;
  }

  return metadata;
}

export async function createSandbox(config: LifecycleConfig, opts?: CreateSandboxOptions): Promise<SandboxHandle> {
  const client = opts?.client ?? createE2BClient();

  const timeoutMs = normalizeTimeoutMs(config.sandbox.timeout_ms);
  const metadata = {
    ...buildMetadataTags(opts?.tags),
    ...(opts?.metadata ?? {})
  };

  const sandbox = await withLifecycleError(
    `Failed to create sandbox from template '${config.sandbox.template}'`,
    () =>
      client.create(config.sandbox.template, {
        timeoutMs,
        metadata,
        envs: opts?.envs,
        requestTimeoutMs: opts?.requestTimeoutMs
      })
  );

  return createSandboxHandle(sandbox);
}

export async function connectSandbox(
  sandboxId: string,
  _config: LifecycleConfig,
  opts?: LifecycleOperationOptions
): Promise<SandboxHandle> {
  const client = opts?.client ?? createE2BClient();

  const sandbox = await withLifecycleError(`Failed to connect to sandbox '${sandboxId}'`, () =>
    client.connect(sandboxId, {
      requestTimeoutMs: opts?.requestTimeoutMs
    })
  );

  return createSandboxHandle(sandbox);
}

export async function listSandboxes(opts?: ListSandboxesOptions): Promise<SandboxListItem[]> {
  const client = opts?.client ?? createE2BClient();
  const metadata = buildMetadataTags(opts?.tags);

  const sandboxes = await withLifecycleError("Failed to list sandboxes", () =>
    client.list({
      metadata: Object.keys(metadata).length === 0 ? undefined : metadata,
      requestTimeoutMs: opts?.requestTimeoutMs
    })
  );

  return sandboxes.map(mapSandboxSummary);
}

export async function killSandbox(sandboxId: string, opts?: LifecycleOperationOptions): Promise<void> {
  const client = opts?.client ?? createE2BClient();

  await withLifecycleError(`Failed to kill sandbox '${sandboxId}'`, () =>
    client.kill(sandboxId, {
      requestTimeoutMs: opts?.requestTimeoutMs
    })
  );
}

export async function refreshTimeout(handle: SandboxHandle, timeoutMs: number): Promise<void> {
  const normalizedTimeoutMs = normalizeTimeoutMs(timeoutMs);
  await handle.setTimeout(normalizedTimeoutMs);
}

function createSandboxHandle(sandbox: E2BSandbox): SandboxHandle {
  return {
    sandboxId: sandbox.sandboxId,
    async run(command, opts) {
      const result = await withLifecycleError(
        `Failed to run command in sandbox '${sandbox.sandboxId}'`,
        () => sandbox.commands.run(command, opts)
      );

      return mapCommandResult(result);
    },
    async getHost(port) {
      return withLifecycleError(
        `Failed to resolve host for sandbox '${sandbox.sandboxId}' on port ${port}`,
        async () => sandbox.getHost(port)
      );
    },
    async setTimeout(timeoutMs) {
      const normalizedTimeoutMs = normalizeTimeoutMs(timeoutMs);
      await withLifecycleError(`Failed to set timeout for sandbox '${sandbox.sandboxId}'`, () =>
        sandbox.setTimeout(normalizedTimeoutMs)
      );
    },
    async kill() {
      await withLifecycleError(`Failed to kill sandbox '${sandbox.sandboxId}'`, () => sandbox.kill());
    }
  };
}

function mapSandboxSummary(summary: E2BSandboxSummary): SandboxListItem {
  return {
    sandboxId: summary.sandboxId,
    state: summary.state,
    metadata: summary.metadata
  };
}

function mapCommandResult(result: SandboxCommandRunResult): { stdout: string; stderr: string; exitCode: number } {
  return {
    stdout: result.stdout,
    stderr: result.stderr,
    exitCode: result.exitCode
  };
}

async function withLifecycleError<T>(message: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    throw new LauncherE2BLifecycleError(formatLifecycleError(message, error), error);
  }
}

function formatLifecycleError(message: string, cause: unknown): string {
  if (cause instanceof Error && cause.message.trim() !== "") {
    return `${message}: ${cause.message}`;
  }

  return message;
}
