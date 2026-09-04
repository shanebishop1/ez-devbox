import { redactSensitiveText } from "../security/redaction.js";

export interface RemoteCommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export function assertRemoteCommandSucceeded(result: RemoteCommandResult, operation: string): void {
  if (result.exitCode === 0) {
    return;
  }

  const detail = result.stderr.trim() || result.stdout.trim() || "no command output";
  throw new Error(redactSensitiveText(`${operation} failed with exit code ${result.exitCode}: ${detail}`));
}
