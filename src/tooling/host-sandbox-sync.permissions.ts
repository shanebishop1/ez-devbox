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

export async function prepareSandboxPrivateFile(
  sandbox: SandboxRunnableHandle,
  sandboxFilePath: string,
): Promise<void> {
  if (!sandbox.run) {
    return;
  }

  const parentDirectory = posix.dirname(sandboxFilePath);
  const file = quoteShellArg(sandboxFilePath);
  const parent = quoteShellArg(parentDirectory);
  const result = await sandbox.run(
    `set -eu; if [ -L ${file} ] || { [ -e ${file} ] && [ ! -f ${file} ]; }; then exit 1; fi; mkdir -p -- ${parent}; chmod 700 ${parent}; if [ ! -e ${file} ]; then (umask 077; : > ${file}); fi; chown user:user ${file}; chmod 600 ${file}`,
  );
  assertPermissionCommandSucceeded(result, sandboxFilePath);
}

export async function assertSandboxPathHasNoSymlinks(
  sandbox: SandboxRunnableHandle,
  sandboxPath: string,
): Promise<void> {
  if (!sandbox.run) {
    return;
  }

  const remainder = sandboxPath.startsWith("/") ? sandboxPath.slice(1) : sandboxPath;
  const script = [
    `remaining=${quoteShellArg(remainder)}`,
    "current=/",
    'while [ -n "$remaining" ]; do',
    '  IFS=/ read -r component remaining <<< "$remaining"',
    '  current="$current/$component"',
    '  if [ -L "$current" ]; then exit 1; fi',
    "done",
  ].join("\n");
  const result = await sandbox.run(`bash -lc ${quoteShellArg(script)}`);
  if (result.exitCode !== 0) {
    throw new Error(`Refusing to sync custom agent file to symlinked sandbox path '${sandboxPath}'.`);
  }
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
