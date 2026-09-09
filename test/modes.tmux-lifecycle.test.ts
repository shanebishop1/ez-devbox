import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type { SandboxHandle } from "../src/e2b/lifecycle.js";
import { buildSessionReadyGateCommand } from "../src/modes/terminal-agent.js";
import { ensureTerminalSession } from "../src/modes/terminal-agent.lifecycle.js";
import {
  ensurePersistentTmuxSession,
  hasPersistentTmuxSession,
  stopOwnedPersistentTmuxSession,
  waitForPersistentTmuxSessionReady,
} from "../src/modes/tmux.js";

const execFileAsync = promisify(execFile);
const socketNames: string[] = [];
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    socketNames.map((socketName) => execFileAsync("tmux", ["-L", socketName, "kill-server"]).catch(() => undefined)),
  );
  await Promise.all(tempRoots.map((path) => rm(path, { recursive: true, force: true })));
  socketNames.length = 0;
  tempRoots.length = 0;
});

describe("tmux lifecycle coordination", () => {
  it("registers exactly one owner and identity when callers create concurrently", async () => {
    const socketName = uniqueName("concurrent");
    socketNames.push(socketName);
    const handle = createLocalHandle();
    const create = (identity: string, ownerToken: string, generationToken: string) =>
      ensurePersistentTmuxSession(handle, {
        socketName,
        sessionName: "agent",
        command: "sleep 30",
        registration: { identity, ownerToken, generationToken },
      });

    const results = await Promise.all([
      create("identity-a", "owner-a", "generation-a"),
      create("identity-b", "owner-b", "generation-b"),
    ]);
    const winner = results.find((result) => result.created);
    const loser = results.find((result) => !result.created);

    expect(winner).toBeDefined();
    expect(loser).toBeDefined();
    expect(results.filter((result) => result.created)).toHaveLength(1);
    expect(loser?.generation).toBe(winner?.generation);
    expect(loser?.registeredIdentity).toBe(winner?.registeredIdentity);
    expect(loser?.registeredOwnerToken).toBe(winner?.registeredOwnerToken);
    expect([
      ["identity-a", "owner-a", "generation-a"],
      ["identity-b", "owner-b", "generation-b"],
    ]).toContainEqual([winner?.registeredIdentity, winner?.registeredOwnerToken, winner?.generation]);
  });

  it("binds registration and rollback to the created session generation", async () => {
    const socketName = uniqueName("ownership");
    socketNames.push(socketName);
    const handle = createLocalHandle();
    const created = await ensurePersistentTmuxSession(handle, {
      socketName,
      sessionName: "agent",
      command: "sleep 30",
      registration: { identity: "identity-a", ownerToken: "owner-a", generationToken: "generation-a" },
    });

    expect(
      await stopOwnedPersistentTmuxSession(handle, socketName, "agent", {
        generation: created.generation,
        ownerToken: "not-the-owner",
      }),
    ).toBe(false);
    expect(await hasPersistentTmuxSession(handle, socketName, "agent")).toBe(true);
    expect(
      await stopOwnedPersistentTmuxSession(handle, socketName, "agent", {
        generation: created.generation,
        ownerToken: "owner-a",
      }),
    ).toBe(true);

    const replacement = await ensurePersistentTmuxSession(handle, {
      socketName,
      sessionName: "agent",
      command: "sleep 30",
      registration: { identity: "identity-b", ownerToken: "owner-b", generationToken: "generation-b" },
    });
    expect(replacement).toMatchObject({ created: true, registeredIdentity: "identity-b" });
    expect(replacement.generation).toBe("generation-b");
  });

  it("abandons an unreleased startup gate in bounded time without running the agent", async () => {
    const root = await mkdtemp(join(tmpdir(), "ez-devbox-gate-interruption-"));
    tempRoots.push(root);
    const sentinelPath = join(root, "agent-started");
    const command = buildSessionReadyGateCommand(`touch ${shellQuote(sentinelPath)}`, {
      socketName: uniqueName("missing"),
      sessionName: "agent",
      ownerToken: "owner-a",
      generationToken: "generation-a",
      maxAttempts: 2,
      intervalSeconds: 0.01,
    });

    const result = await runShell(command);

    expect(result.exitCode).not.toBe(0);
    await expect(writeFile(sentinelPath, "", { flag: "wx" })).resolves.toBeUndefined();
  });

  it("uses printable metadata separators compatible with tmux 3.3", async () => {
    let startupCommand = "";
    const handle = {
      ...createLocalHandle(),
      run: async (command: string) => {
        startupCommand = command;
        return {
          stdout: "EZ_DEVBOX_TMUX_SESSION\tEXISTING\tgeneration-a\tidentity-a\towner-a\t%1\n",
          stderr: "",
          exitCode: 0,
        };
      },
    };

    await ensurePersistentTmuxSession(handle, {
      socketName: "socket",
      sessionName: "agent",
      command: "sleep 30",
      registration: { identity: "identity-a", ownerToken: "owner-a", generationToken: "generation-a" },
    });
    const gateCommand = buildSessionReadyGateCommand("sleep 30", {
      socketName: "socket",
      sessionName: "agent",
      ownerToken: "owner-a",
      generationToken: "generation-a",
    });

    expect(startupCommand).not.toContain("#{@ez_devbox_generation}\t#{@ez_devbox_identity}");
    expect(gateCommand).not.toContain("#{@ez_devbox_generation}\t#{@ez_devbox_owner}");
  });

  it("re-elects a creator after an incomplete existing session disappears", async () => {
    const socketName = uniqueName("registration-retry");
    socketNames.push(socketName);
    const handle = createLocalHandle();
    await execFileAsync("tmux", ["-L", socketName, "new-session", "-d", "-s", "agent", "sleep 0.1"]);
    const command = buildSessionReadyGateCommand("sleep 30", {
      socketName,
      sessionName: "agent",
      ownerToken: "owner-a",
      generationToken: "generation-a",
      readinessDelaySeconds: 0.05,
    });

    const result = await ensureTerminalSession({
      handle,
      socketName,
      sessionName: "agent",
      command,
      envs: {},
      registration: { identity: "identity-a", ownerToken: "owner-a", generationToken: "generation-a" },
    });

    expect(result).toMatchObject({ created: true, generation: "generation-a", registeredIdentity: "identity-a" });
  });

  it("does not report ready when the configured executable exits after gate release", async () => {
    const root = await mkdtemp(join(tmpdir(), "ez-devbox-gate-readiness-"));
    tempRoots.push(root);
    const socketName = uniqueName("readiness");
    socketNames.push(socketName);
    const ownerToken = "owner-a";
    const handle = createLocalHandle();
    const command = buildSessionReadyGateCommand("exit 19", {
      socketName,
      sessionName: "agent",
      ownerToken,
      generationToken: "generation-a",
      maxAttempts: 100,
      intervalSeconds: 0.01,
      readinessDelaySeconds: 0.05,
    });
    const created = await ensurePersistentTmuxSession(handle, {
      socketName,
      sessionName: "agent",
      command,
      registration: { identity: "identity-a", ownerToken, generationToken: "generation-a" },
    });

    await execFileAsync("tmux", ["-L", socketName, "set-option", "-t", "agent", "@ez_devbox_startup_gate", "released"]);

    const readiness = await waitForPersistentTmuxSessionReady(handle, socketName, "agent", created.generation, {
      maxAttempts: 50,
      intervalSeconds: 0.01,
    });
    expect(readiness).not.toBe("ready");
  });

  it("reports ready only after releasing the owned gate and observing the launched process", async () => {
    const socketName = uniqueName("ready-process");
    socketNames.push(socketName);
    const ownerToken = "owner-a";
    const generationToken = "generation-a";
    const command = buildSessionReadyGateCommand("sleep 30", {
      socketName,
      sessionName: "agent",
      ownerToken,
      generationToken,
      readinessDelaySeconds: 0.05,
    });

    const result = await ensureTerminalSession({
      handle: createLocalHandle(),
      socketName,
      sessionName: "agent",
      command,
      envs: {},
      registration: { identity: "identity-a", ownerToken, generationToken },
    });

    expect(result).toMatchObject({ created: true, generation: generationToken, registeredIdentity: "identity-a" });
  });
});

function uniqueName(label: string): string {
  return `ezdb-test-${label}-${process.pid}-${Date.now()}-${socketNames.length}`;
}

function createLocalHandle(): SandboxHandle {
  return {
    sandboxId: "local-test",
    run: async (command, options) => runShell(command, options?.cwd, options?.envs),
    writeFile: async (path, data) => writeFile(path, Buffer.from(data as ArrayBuffer)),
    getHost: async () => "localhost",
    setTimeout: async () => undefined,
    kill: async () => undefined,
  };
}

async function runShell(
  command: string,
  cwd?: string,
  envs?: Record<string, string>,
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  try {
    const result = await execFileAsync("bash", ["-lc", command], {
      ...(cwd ? { cwd } : {}),
      env: { ...process.env, ...envs },
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const result = error as { stdout?: string; stderr?: string; code?: number };
    return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", exitCode: result.code ?? 1 };
  }
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}
