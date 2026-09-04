import { posix } from "node:path";
import type { SandboxHandle } from "../e2b/lifecycle.js";

type SandboxRunnableHandle = Partial<Pick<SandboxHandle, "run">>;

export async function restrictSandboxDirectoryPermissions(
  sandbox: SandboxRunnableHandle,
  sandboxDirectoryPath: string,
): Promise<void> {
  if (!sandbox.run) {
    return;
  }

  const directory = quoteShellArg(sandboxDirectoryPath);
  const result = await sandbox.run(
    `chmod 700 ${directory} && find ${directory} -type d -exec chmod 700 {} + && find ${directory} -type f -exec chmod 600 {} +`,
  );
  assertPermissionCommandSucceeded(result, sandboxDirectoryPath);
}

export async function restrictSandboxFilePermissions(
  sandbox: SandboxRunnableHandle,
  sandboxFilePath: string,
): Promise<void> {
  if (!sandbox.run) {
    return;
  }

  const parentDirectory = posix.dirname(sandboxFilePath);
  const result = await sandbox.run(
    `chmod 700 ${quoteShellArg(parentDirectory)} && chmod 600 ${quoteShellArg(sandboxFilePath)}`,
  );
  assertPermissionCommandSucceeded(result, sandboxFilePath);
}

function quoteShellArg(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

function assertPermissionCommandSucceeded(
  result: { stdout: string; stderr: string; exitCode: number },
  sandboxPath: string,
): void {
  if (result.exitCode !== 0) {
    throw new Error(`Failed to restrict permissions for synced sandbox path '${sandboxPath}'.`);
  }
}
