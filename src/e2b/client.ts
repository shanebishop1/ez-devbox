import { Sandbox } from "e2b";

export interface SandboxCommandRunResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface SandboxCommandRunOptions {
  cwd?: string;
  envs?: Record<string, string>;
}

export interface E2BSandbox {
  sandboxId: string;
  commands: {
    run(command: string, opts?: SandboxCommandRunOptions): Promise<SandboxCommandRunResult>;
  };
  getHost(port: number): string;
  setTimeout(timeoutMs: number): Promise<void>;
  kill(): Promise<void>;
}

export interface E2BClientOptions {
  requestTimeoutMs?: number;
}

export interface E2BCreateSandboxOptions extends E2BClientOptions {
  timeoutMs: number;
  metadata?: Record<string, string>;
  envs?: Record<string, string>;
}

export interface E2BListSandboxesOptions extends E2BClientOptions {
  metadata?: Record<string, string>;
}

export interface E2BSandboxSummary {
  sandboxId: string;
  state: string;
  metadata?: Record<string, string>;
}

export interface E2BClient {
  create(template: string, opts: E2BCreateSandboxOptions): Promise<E2BSandbox>;
  connect(sandboxId: string, opts?: E2BClientOptions): Promise<E2BSandbox>;
  list(opts?: E2BListSandboxesOptions): Promise<E2BSandboxSummary[]>;
  kill(sandboxId: string, opts?: E2BClientOptions): Promise<boolean>;
}

export function createE2BClient(): E2BClient {
  return {
    async create(template, opts) {
      return Sandbox.create(template, {
        timeoutMs: opts.timeoutMs,
        metadata: opts.metadata,
        envs: opts.envs,
        requestTimeoutMs: opts.requestTimeoutMs
      });
    },
    async connect(sandboxId, opts) {
      return Sandbox.connect(sandboxId, {
        requestTimeoutMs: opts?.requestTimeoutMs
      });
    },
    async list(opts) {
      const sandboxes = await Sandbox.list({
        query: opts?.metadata === undefined ? undefined : { metadata: opts.metadata },
        requestTimeoutMs: opts?.requestTimeoutMs
      });

      return sandboxes.map((sandbox) => ({
        sandboxId: sandbox.sandboxId,
        state: sandbox.state,
        metadata: sandbox.metadata
      }));
    },
    async kill(sandboxId, opts) {
      return Sandbox.kill(sandboxId, {
        requestTimeoutMs: opts?.requestTimeoutMs
      });
    }
  };
}
