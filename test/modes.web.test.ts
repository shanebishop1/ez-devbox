import { execFile } from "node:child_process";
import { access, chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { SandboxHandle } from "../src/e2b/lifecycle.js";
import { startWebMode } from "../src/modes/web.js";

const execFileAsync = promisify(execFile);
const harnesses: LocalWebHarness[] = [];

// This suite executes the Linux sandbox shell contract, including /proc ownership checks.
describe.skipIf(process.platform !== "linux")("web mode generated shell", () => {
  afterEach(async () => {
    await Promise.all(harnesses.splice(0).map(cleanupHarness));
  });

  it("checks the effective password before executing the mocked public listener", async () => {
    const harness = await createHarness(["000"]);

    await expect(startWebMode(harness.handle)).rejects.toThrow("requires a nonempty OPENCODE_SERVER_PASSWORD");
    await expect(access(harness.invocationPath)).rejects.toThrow();
    expect(harness.commands).toHaveLength(1);
  });

  it("reuses an authenticated listener without a host password", async () => {
    const harness = await createHarness(["401"]);

    const result = await startWebMode(harness.handle);

    expect(result).toMatchObject({
      readiness: "ready",
      details: { authRequired: true, authStatus: 401 },
    });
    expect(result.message).toContain("Reused web mode");
    await expect(access(harness.invocationPath)).rejects.toThrow();
  });

  it("refuses an existing unauthenticated listener without stopping or replacing it", async () => {
    const harness = await createHarness(["200"]);

    await expect(startWebMode(harness.handle)).rejects.toThrow("Refusing to reuse or stop it");
    await expect(access(harness.invocationPath)).rejects.toThrow();
    expect(harness.commands).toHaveLength(1);
  });

  it("starts the mocked listener with an effective password using the generated shell", async () => {
    const harness = await createHarness(["000", "401", "401"], { expectLaunch: true });

    const result = await startWebMode(harness.handle, {
      startupEnv: { OPENCODE_SERVER_PASSWORD: "local-test-password" },
    });

    expect(result.message).toContain("Started web mode");
    expect(await readFile(harness.invocationPath, "utf8")).toContain("serve --hostname 0.0.0.0 --port 3000");
    expect((await readFile(harness.ownerPath, "utf8")).trim()).not.toBe("");
    expect(harness.commands.join("\n")).not.toContain("local-test-password");
  });

  it("stops only its tagged process when authentication verification fails", async () => {
    const harness = await createHarness(["000", "200", "200"], { expectLaunch: true });

    await expect(
      startWebMode(harness.handle, { startupEnv: { OPENCODE_SERVER_PASSWORD: "local-test-password" } }),
    ).rejects.toThrow("The listener process owned by this invocation was stopped");

    const pid = Number(await readFile(harness.pidPath, "utf8"));
    expect(isProcessRunning(pid)).toBe(false);
    expect(harness.commands.at(-1)).toContain("/proc/$pid/environ");
    expect(harness.commands.at(-1)).not.toContain("pkill");
  });

  it("stops only its tagged process when readiness fails", async () => {
    const harness = await createHarness(["000"], { expectLaunch: true });

    await expect(
      startWebMode(harness.handle, { startupEnv: { OPENCODE_SERVER_PASSWORD: "local-test-password" } }),
    ).rejects.toThrow("The listener process owned by this invocation was stopped");

    const pid = Number(await readFile(harness.pidPath, "utf8"));
    expect(isProcessRunning(pid)).toBe(false);
  });

  it("does not stop a process when the generated cleanup shell cannot verify ownership", async () => {
    const harness = await createHarness(["000", "200", "200"], { expectLaunch: true, stripOwnerTag: true });

    await expect(
      startWebMode(harness.handle, { startupEnv: { OPENCODE_SERVER_PASSWORD: "local-test-password" } }),
    ).rejects.toThrow("Cleanup refused to stop the process because ownership could not be verified");

    const pid = Number(await readFile(harness.pidPath, "utf8"));
    expect(isProcessRunning(pid)).toBe(true);
  });
});

interface LocalWebHarness {
  root: string;
  handle: SandboxHandle;
  commands: string[];
  invocationPath: string;
  ownerPath: string;
  pidPath: string;
}

async function createHarness(
  statuses: string[],
  options: { expectLaunch?: boolean; stripOwnerTag?: boolean } = {},
): Promise<LocalWebHarness> {
  const root = await mkdtemp(join(tmpdir(), "ez-devbox-web-test-"));
  const binDirectory = join(root, "bin");
  const invocationPath = join(root, "opencode-invocation");
  const ownerPath = join(root, "opencode-owner");
  const pidPath = join(root, "opencode-pid");
  const bashEnvPath = join(root, "bash-env");
  const commands: string[] = [];
  await mkdir(binDirectory);
  await writeFile(join(root, "statuses"), statuses.join(","));
  if (options.expectLaunch) {
    await writeFile(join(root, "expect-launch"), "");
  }
  if (options.stripOwnerTag) {
    await writeFile(join(root, "strip-owner-tag"), "");
  }
  await writeFile(bashEnvPath, `export PATH="${binDirectory}:/usr/bin:/bin"\n`);
  await writeExecutable(join(binDirectory, "curl"), mockCurlScript());
  await writeExecutable(join(binDirectory, "opencode"), mockOpenCodeScript());
  await writeExecutable(join(binDirectory, "opencode-untagged"), mockUntaggedOpenCodeScript());
  await writeExecutable(join(binDirectory, "sleep"), "#!/bin/bash\nexec /bin/sleep 0.01\n");

  const baseEnv: NodeJS.ProcessEnv = {
    ...process.env,
    BASH_ENV: bashEnvPath,
    EZ_WEB_TEST_ROOT: root,
    PATH: `${binDirectory}:/usr/bin:/bin`,
  };
  delete baseEnv.OPENCODE_SERVER_PASSWORD;

  const handle: SandboxHandle = {
    sandboxId: "local-web-shell-test",
    async run(command, options) {
      commands.push(command);
      const env = { ...baseEnv, ...(options?.envs ?? {}) };
      try {
        const result = await execFileAsync("/bin/bash", ["-c", command], {
          cwd: options?.cwd,
          env,
          encoding: "utf8",
          timeout: options?.timeoutMs,
        });
        return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
      } catch (error) {
        const commandError = error as Error & { stdout?: string; stderr?: string; code?: number; exitCode?: number };
        commandError.stdout ??= "";
        commandError.stderr ??= "";
        commandError.exitCode = typeof commandError.code === "number" ? commandError.code : 1;
        throw commandError;
      }
    },
    async writeFile() {},
    async getHost() {
      return "local-web-shell-test.e2b.app";
    },
    async setTimeout() {},
    async kill() {},
  };
  const harness = { root, handle, commands, invocationPath, ownerPath, pidPath };
  harnesses.push(harness);
  return harness;
}

async function writeExecutable(path: string, contents: string): Promise<void> {
  await writeFile(path, contents);
  await chmod(path, 0o700);
}

function mockCurlScript(): string {
  return `#!/bin/bash
count_file="$EZ_WEB_TEST_ROOT/curl-count"
count=0
if [ -f "$count_file" ]; then read -r count < "$count_file"; fi
count=$((count + 1))
printf "%s\\n" "$count" > "$count_file"
if [ "$count" -gt 1 ] && [ -f "$EZ_WEB_TEST_ROOT/expect-launch" ]; then
  for attempt in {1..100}; do
    if [ -f "$EZ_WEB_TEST_ROOT/opencode-pid" ] && [ -f "$EZ_WEB_TEST_ROOT/opencode-invocation" ]; then break; fi
    /bin/sleep 0.01
  done
fi
IFS="," read -r -a statuses < "$EZ_WEB_TEST_ROOT/statuses"
index=$((count - 1))
last_index=$((\${#statuses[@]} - 1))
status="\${statuses[$index]:-\${statuses[$last_index]:-000}}"
printf "%s" "$status"
if [ "$status" = 000 ]; then exit 7; fi
`;
}

function mockOpenCodeScript(): string {
  return `#!/bin/bash
if [ -f "$EZ_WEB_TEST_ROOT/strip-owner-tag" ]; then
  exec env -u EZ_DEVBOX_WEB_OWNER "$EZ_WEB_TEST_ROOT/bin/opencode-untagged" "$@"
fi
printf "%s\\n" "$*" > "$EZ_WEB_TEST_ROOT/opencode-invocation"
printf "%s\\n" "$EZ_DEVBOX_WEB_OWNER" > "$EZ_WEB_TEST_ROOT/opencode-owner"
printf "%s\\n" "$$" > "$EZ_WEB_TEST_ROOT/opencode-pid"
trap "exit 0" TERM INT
while :; do /bin/sleep 0.1; done
`;
}

function mockUntaggedOpenCodeScript(): string {
  return `#!/bin/bash
printf "%s\\n" "$*" > "$EZ_WEB_TEST_ROOT/opencode-invocation"
printf "\\n" > "$EZ_WEB_TEST_ROOT/opencode-owner"
printf "%s\\n" "$$" > "$EZ_WEB_TEST_ROOT/opencode-pid"
trap "exit 0" TERM INT
while :; do /bin/sleep 0.1; done
`;
}

async function cleanupHarness(harness: LocalWebHarness): Promise<void> {
  let pid: number;
  try {
    pid = Number(await readFile(harness.pidPath, "utf8"));
  } catch {
    await rm(harness.root, { recursive: true, force: true });
    return;
  }

  try {
    if (await isHarnessProcess(pid, harness.root)) {
      signalProcess(pid, "SIGTERM");
      await waitForProcessExit(pid);
    }
    if (await isHarnessProcess(pid, harness.root)) {
      signalProcess(pid, "SIGKILL");
      await waitForProcessExit(pid);
    }
    if (await isHarnessProcess(pid, harness.root)) {
      throw new Error(`Local web test process ${pid} did not stop`);
    }
  } finally {
    await rm(harness.root, { recursive: true, force: true });
  }
}

async function isHarnessProcess(pid: number, root: string): Promise<boolean> {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    const environment = await readFile(`/proc/${pid}/environ`, "utf8");
    return environment.split("\0").includes(`EZ_WEB_TEST_ROOT=${root}`);
  } catch {
    return false;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signalProcess(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (isProcessRunning(pid)) {
      throw error;
    }
  }
}

async function waitForProcessExit(pid: number): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    if (!isProcessRunning(pid)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
