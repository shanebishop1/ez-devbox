import type { SandboxHandle } from "../e2b/lifecycle.js";
import { redactSensitiveText } from "../security/redaction.js";

export interface BootstrapCommandOptions {
  timeoutMs?: number;
  cwd?: string;
  envs?: Record<string, string>;
  commandLabel: string;
}

export interface BootstrapCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export async function runCommand(
  handle: SandboxHandle,
  command: string,
  options: BootstrapCommandOptions
): Promise<BootstrapCommandResult> {
  try {
    return await handle.run(command, {
      timeoutMs: options.timeoutMs,
      cwd: options.cwd,
      envs: options.envs
    });
  } catch (error) {
    throw new Error(redactSensitiveText(`Bootstrap command failed (${options.commandLabel}): ${toErrorMessage(error)}`));
  }
}

export async function runRequiredCommand(
  handle: SandboxHandle,
  command: string,
  options: { timeoutMs: number; commandLabel: string; envs?: Record<string, string> }
): Promise<BootstrapCommandResult> {
  const result = await runCommand(handle, command, {
    timeoutMs: options.timeoutMs,
    envs: options.envs,
    commandLabel: options.commandLabel
  });
  if (result.exitCode !== 0) {
    throw new Error(redactSensitiveText(`Command failed: ${command}: ${result.stderr || result.stdout || "unknown error"}`));
  }
  return result;
}

export async function runBoolCheck(
  handle: SandboxHandle,
  command: string,
  options: { timeoutMs: number; commandLabel: string }
): Promise<boolean> {
  const result = await runCommand(handle, command, {
    timeoutMs: options.timeoutMs,
    commandLabel: options.commandLabel
  });
  if (result.exitCode !== 0) {
    throw new Error(redactSensitiveText(`Command failed: ${command}: ${result.stderr || result.stdout || "unknown error"}`));
  }

  const marker = result.stdout.trim();
  if (marker === "EZBOX_TRUE") {
    return true;
  }
  if (marker === "EZBOX_FALSE") {
    return false;
  }

  throw new Error(`Command failed: ${command}: unexpected boolean marker '${marker || "empty"}'`);
}

export function emitLines(output: string, onLine?: (line: string) => void): void {
  if (!onLine || output.trim() === "") {
    return;
  }

  for (const line of output.split(/\r?\n/)) {
    if (line === "") {
      continue;
    }
    onLine(line);
  }
}

export function quoteShellArg(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export function quoteShellDoubleArg(value: string): string {
  return `"${value.replace(/["\\`]/g, "\\$&")}"`;
}

export function truncateForLog(value: string, maxLength = 240): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength)}...`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }
  return "unknown error";
}
