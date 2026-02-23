export interface SandboxHandle {
  sandboxId: string;
  run(command: string): Promise<{ stdout: string; stderr: string; exitCode: number }>;
  getHost(port: number): Promise<string>;
  setTimeout(timeoutMs: number): Promise<void>;
  kill(): Promise<void>;
}

export async function createSandbox(): Promise<SandboxHandle> {
  throw new Error("createSandbox not implemented yet");
}

export async function connectSandbox(sandboxId: string): Promise<SandboxHandle> {
  throw new Error(`connectSandbox not implemented yet for ${sandboxId}`);
}
