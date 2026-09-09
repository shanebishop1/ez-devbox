import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getCustomAgentFingerprint } from "../src/config/custom-agent.validation.js";
import { LauncherE2BLifecycleError, type SandboxHandle } from "../src/e2b/lifecycle.js";
import { startCustomMode } from "../src/modes/custom.js";
import { buildInitialPromptScript } from "../src/modes/terminal-agent.js";

const execFileAsync = promisify(execFile);
const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.map((path) => rm(path, { recursive: true, force: true })));
  tempRoots.length = 0;
});

describe("custom terminal agent mode", () => {
  it("checks, installs when missing, verifies, and starts a persistent custom session", async () => {
    const agent = {
      command: ["my-agent", "--interactive"],
      check_command: "command -v my-agent",
      install_command: "npm install -g my-agent",
      files: [],
    };
    const run = vi
      .fn()
      .mockResolvedValueOnce(ok("ABSENT"))
      .mockResolvedValueOnce(ok("missing", 1))
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(ok("present"))
      .mockResolvedValueOnce(tmuxResult("CREATED", agent))
      .mockResolvedValueOnce(ok("RELEASED"))
      .mockResolvedValueOnce(ok("READY"));

    const result = await startCustomMode(createHandle({ run }), {
      detach: true,
      customAgent: agent,
    });

    expect(run).toHaveBeenNthCalledWith(3, "npm install -g my-agent", expect.objectContaining({ timeoutMs: 120_000 }));
    expect(String(run.mock.calls[4]?.[0])).toContain("ez-devbox-custom");
    expect(result).toMatchObject({
      mode: "ssh-custom",
      readiness: "ready",
      attachment: "detached",
      connection: { type: "tmux", socketName: "ez-devbox-custom", sessionName: "ez-devbox-custom" },
    });
  });

  it("skips installation when the availability check succeeds", async () => {
    const agent = {
      command: ["my-agent"],
      check_command: "command -v my-agent",
      install_command: "must-not-run",
      files: [],
    };
    const run = vi
      .fn()
      .mockResolvedValueOnce(ok("ABSENT"))
      .mockResolvedValueOnce(ok("present"))
      .mockResolvedValueOnce(tmuxResult("CREATED", agent))
      .mockResolvedValueOnce(ok("RELEASED"))
      .mockResolvedValueOnce(ok("READY"));

    await startCustomMode(createHandle({ run }), {
      detach: true,
      customAgent: agent,
    });

    expect(run).toHaveBeenCalledTimes(5);
    expect(run.mock.calls.some(([command]) => command === "must-not-run")).toBe(false);
  });

  it("treats a rejected nonzero availability check as a missing agent", async () => {
    const agent = {
      command: ["my-agent"],
      check_command: "command -v my-agent",
      install_command: "install-my-agent",
      files: [],
    };
    const run = vi
      .fn()
      .mockResolvedValueOnce(ok("ABSENT"))
      .mockRejectedValueOnce(new LauncherE2BLifecycleError("check failed", { result: { exitCode: 1 } }))
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(tmuxResult("CREATED", agent))
      .mockResolvedValueOnce(ok("RELEASED"))
      .mockResolvedValueOnce(ok("READY"));

    await startCustomMode(createHandle({ run }), {
      detach: true,
      customAgent: agent,
    });

    expect(run.mock.calls[2]?.[0]).toBe("install-my-agent");
  });

  it("fails installation without claiming readiness and does not expose command output", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(ok("ABSENT"))
      .mockResolvedValueOnce(ok("missing", 1))
      .mockResolvedValueOnce(ok("private-output", 1));

    await expect(
      startCustomMode(createHandle({ run }), {
        detach: true,
        customAgent: {
          command: ["my-agent"],
          check_command: "command -v my-agent",
          install_command: "install-my-agent",
          files: [],
        },
      }),
    ).rejects.toThrow("installation failed");
    await expect(
      startCustomMode(
        createHandle({ run: vi.fn().mockResolvedValueOnce(ok("ABSENT")).mockResolvedValueOnce(ok("missing", 1)) }),
        {
          detach: true,
          customAgent: { command: ["my-agent"], check_command: "check", files: [] },
        },
      ),
    ).rejects.toThrow("not available");
  });

  it("delivers an initial prompt through the configured whole-argument placeholder", async () => {
    const prompt = "quotes ' \n$(not-a-command) ; --literal";
    const writeFile = vi.fn().mockResolvedValue(undefined);
    const agent = {
      command: ["my-agent"],
      check_command: "command -v my-agent",
      initial_prompt_command: ["my-agent", "--special-prompt-flag", "{prompt}"],
      files: [],
    };
    const run = vi
      .fn()
      .mockResolvedValueOnce(ok("ABSENT"))
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(ok("present"))
      .mockResolvedValueOnce(ok())
      .mockResolvedValueOnce(tmuxResult("CREATED", agent))
      .mockResolvedValueOnce(ok("RELEASED"))
      .mockResolvedValueOnce(ok("READY"));

    await startCustomMode(createHandle({ run, writeFile }), {
      detach: true,
      prompt: { kind: "initial", text: prompt },
      customAgent: agent,
    });

    expect(writeFile).toHaveBeenCalledWith(expect.stringContaining("ez-devbox-initial-prompt-"), prompt);
    const startupCommand = run.mock.calls.find(([command]) => String(command).includes("--special-prompt-flag"));
    expect(String(startupCommand?.[0])).toContain("--special-prompt-flag");
    expect(String(startupCommand?.[0])).toContain('"$prompt"');
    expect(String(startupCommand?.[0])).not.toContain(prompt);
  });

  it("rejects an initial prompt when no prompt command is configured", async () => {
    await expect(
      startCustomMode(createHandle({ run: vi.fn() }), {
        detach: true,
        prompt: { kind: "initial", text: "hello" },
        customAgent: { command: ["my-agent"], files: [] },
      }),
    ).rejects.toThrow("initial_prompt_command");
  });

  it("rejects follow-ups unless tmux delivery is explicitly enabled", async () => {
    const run = vi
      .fn()
      .mockResolvedValueOnce(ok("ABSENT"))
      .mockResolvedValueOnce(ok("present"))
      .mockResolvedValueOnce(ok("EXISTING"));

    await expect(
      startCustomMode(createHandle({ run }), {
        detach: true,
        prompt: { kind: "follow-up", text: "hello" },
        customAgent: { command: ["my-agent"], files: [] },
      }),
    ).rejects.toThrow('follow_up = "tmux"');
  });

  it("rejects an existing session created with a different custom-agent configuration", async () => {
    const originalAgent = { command: ["agent-a"], files: [] };
    const replacementAgent = { command: ["agent-b"], check_command: "must-not-run", files: [] };
    const run = vi.fn().mockImplementation(async (command: string) => {
      if (command.includes("printf PRESENT") && !command.includes("new-session")) return ok("PRESENT");
      if (command.includes("new-session")) return tmuxResult("EXISTING", originalAgent);
      return ok();
    });

    await expect(
      startCustomMode(createHandle({ run }), { detach: true, customAgent: replacementAgent }),
    ).rejects.toThrow("different agent configuration");
    expect(run.mock.calls.some(([command]) => command === "must-not-run")).toBe(false);
    expect(run.mock.calls.slice(2).some(([command]) => String(command).includes("kill-session"))).toBe(false);
  });

  it("protects and cleans up an initial prompt staging file when the write fails", async () => {
    const run = vi.fn().mockResolvedValue(ok());
    const writeFile = vi.fn().mockRejectedValue(new Error("partial write"));

    await expect(
      startCustomMode(createHandle({ run, writeFile }), {
        detach: true,
        prompt: { kind: "initial", text: "secret prompt" },
        customAgent: {
          command: ["my-agent"],
          check_command: "command -v my-agent",
          initial_prompt_command: ["my-agent", "{prompt}"],
          files: [],
        },
      }),
    ).rejects.toThrow("partial write");

    expect(run.mock.calls.some(([command]) => String(command).includes("chmod 600"))).toBe(true);
    expect(run.mock.calls.some(([command]) => String(command).startsWith("rm -f --"))).toBe(true);
  });

  it("executes the generated prompt script with literal argv data", async () => {
    const root = await mkdtemp(join(tmpdir(), "ez-devbox-custom-script-"));
    tempRoots.push(root);
    const executable = join(root, "fake-agent");
    const argsPath = join(root, "args");
    const promptPath = join(root, "prompt");
    const maliciousPrompt = `literal 'quotes'\n$(touch ${root}/sentinel) ; \`backticks\` > --leading`;
    await writeFile(executable, `#!/bin/sh\nprintf '%s\\0' "$@" > ${argsPath}\n`, { encoding: "utf8" });
    await chmod(executable, 0o700);
    await writeFile(promptPath, maliciousPrompt, "utf8");

    await execFileAsync("bash", ["-lc", buildInitialPromptScript([executable, "--prompt", "{prompt}"], promptPath)]);

    const args = (await readFile(argsPath)).toString("utf8").split("\0").filter(Boolean);
    expect(args).toEqual(["--prompt", maliciousPrompt]);
    await expect(readFile(join(root, "sentinel"))).rejects.toMatchObject({ code: "ENOENT" });
    await expect(readFile(promptPath)).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("executes a safe positional environment wrapper without turning the prompt into code", async () => {
    const root = await mkdtemp(join(tmpdir(), "ez-devbox-custom-wrapper-"));
    tempRoots.push(root);
    const executable = join(root, "fake-agent");
    const argsPath = join(root, "args");
    const promptPath = join(root, "prompt");
    const prompt = "literal $(not-a-command)";
    await writeFile(executable, `#!/bin/sh\nprintf '%s\\0' "$@" > ${argsPath}\n`, { encoding: "utf8" });
    await chmod(executable, 0o700);
    await writeFile(promptPath, prompt, "utf8");

    await execFileAsync("bash", [
      "-lc",
      buildInitialPromptScript(["env", "CUSTOM_MODE=1", executable, "--prompt", "{prompt}"], promptPath),
    ]);

    const args = (await readFile(argsPath)).toString("utf8").split("\0").filter(Boolean);
    expect(args).toEqual(["--prompt", prompt]);
  });

  it("registers the custom-agent identity before delivering a prompt to a newly-created session", async () => {
    const events: string[] = [];
    const agent = { command: ["my-agent"], follow_up: "tmux" as const, files: [] };
    const run = vi.fn().mockImplementation(async (command: string) => {
      events.push(`run:${command}`);
      if (command.includes("new-session")) {
        return tmuxResult("CREATED", agent);
      }
      if (command.includes("@ez_devbox_startup_gate released")) {
        return ok("RELEASED");
      }
      if (command.includes("startup_state") && command.includes("attempts=0")) {
        return ok("READY");
      }
      if (command.includes("display-message -p SENT")) {
        return ok("SENT");
      }
      return ok();
    });
    const writeFile = vi.fn().mockImplementation(async (path: string) => {
      events.push(`write:${path}`);
    });

    await startCustomMode(createHandle({ run, writeFile }), {
      detach: true,
      prompt: { kind: "follow-up", text: "literal prompt" },
      customAgent: agent,
    });

    const identityWrite = events.findIndex((event) => event.includes("@ez_devbox_identity"));
    const promptWrite = events.findIndex((event) => event.includes("ez-devbox-prompt-"));
    expect(identityWrite).toBeGreaterThanOrEqual(0);
    expect(promptWrite).toBeGreaterThan(identityWrite);
  });

  it("rolls back only its generation when startup gate release fails", async () => {
    const agent = { command: ["my-agent"], files: [] };
    const run = vi.fn().mockImplementation(async (command: string) => {
      if (command.includes("new-session")) return tmuxResult("CREATED", agent);
      if (command.includes("@ez_devbox_startup_gate released")) return ok("", 1);
      if (command.includes("kill-session")) return ok("STOPPED");
      return ok();
    });

    await expect(
      startCustomMode(createHandle({ run }), {
        detach: true,
        customAgent: agent,
      }),
    ).rejects.toThrow("startup gate");
    const cleanupCommand = run.mock.calls.find(([command]) => String(command).includes("kill-session"));
    expect(String(cleanupCommand?.[0])).toContain("$generation");
    expect(String(cleanupCommand?.[0])).toContain("@ez_devbox_owner");
  });

  it("executes a safe bash positional wrapper without turning the prompt into shell code", async () => {
    const root = await mkdtemp(join(tmpdir(), "ez-devbox-custom-bash-wrapper-"));
    tempRoots.push(root);
    const executable = join(root, "fake-agent");
    const argsPath = join(root, "args");
    const promptPath = join(root, "prompt");
    const prompt = `literal $(touch ${root}/sentinel) ; \`backticks\``;
    await writeFile(executable, `#!/bin/sh\nprintf '%s\\0' "$@" > ${argsPath}\n`, { encoding: "utf8" });
    await chmod(executable, 0o700);
    await writeFile(promptPath, prompt, "utf8");

    await execFileAsync("bash", [
      "-lc",
      buildInitialPromptScript(["bash", "-c", `exec ${executable} --flag "$1"`, "wrapper", "{prompt}"], promptPath),
    ]);

    const args = (await readFile(argsPath)).toString("utf8").split("\0").filter(Boolean);
    expect(args).toEqual(["--flag", prompt]);
    await expect(readFile(join(root, "sentinel"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

function ok(stdout = "", exitCode = 0): { stdout: string; stderr: string; exitCode: number } {
  return { stdout, stderr: "", exitCode };
}

function tmuxResult(
  state: "CREATED" | "EXISTING",
  agent: Parameters<typeof getCustomAgentFingerprint>[0],
): { stdout: string; stderr: string; exitCode: number } {
  return ok(`EZ_DEVBOX_TMUX_SESSION\t${state}\t$1:1\t${getCustomAgentFingerprint(agent)}\towner-from-remote\t%1`);
}

function createHandle(overrides: Partial<SandboxHandle> = {}): SandboxHandle {
  return {
    sandboxId: "sbx-custom",
    run: vi.fn().mockResolvedValue(ok()),
    writeFile: vi.fn().mockResolvedValue(undefined),
    getHost: vi.fn().mockResolvedValue("sbx.e2b.app"),
    setTimeout: vi.fn().mockResolvedValue(undefined),
    kill: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}
