import { describe, expect, it, vi } from "vitest";
import { runSetupPipeline, type SetupCommandExecutor } from "../src/setup/runner.js";

describe("setup runner", () => {
  it("retries failed step and then succeeds", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const events: string[] = [];
    let setupAttempts = 0;

    const executor: SetupCommandExecutor = {
      run: vi.fn().mockImplementation(async (command, options) => {
        if (command === "echo pre") {
          options.onStdoutLine?.("pre ok");
          return { exitCode: 0 };
        }

        setupAttempts += 1;
        options.onStderrLine?.(`setup attempt ${setupAttempts}`);
        if (setupAttempts === 1) {
          return { exitCode: 1, stderr: "transient failure" };
        }

        return { exitCode: 0 };
      })
    };

    const result = await runSetupPipeline(
      [
        {
          name: "repo-a",
          path: "/workspace/repo-a",
          setup_pre_command: "echo pre",
          setup_command: "npm ci",
          setup_wrapper_command: "bash -lc \"{command}\"",
          setup_env: { NODE_ENV: "test" }
        }
      ],
      executor,
      {
        retryPolicy: { attempts: 2, delayMs: 5 },
        timeoutMs: 20_000,
        sleep,
        onEvent: (event) => events.push(event.type)
      }
    );

    expect(result.success).toBe(true);
    expect(executor.run).toHaveBeenNthCalledWith(
      2,
      'bash -lc "npm ci"',
      expect.objectContaining({ timeoutMs: 20_000, env: { NODE_ENV: "test" } })
    );
    expect(sleep).toHaveBeenCalledTimes(1);
    expect(events).toContain("step:retry");
    expect(events).toContain("step:stdout");
    expect(events).toContain("step:stderr");
  });

  it("stops and fails when continueOnError is false", async () => {
    const executor: SetupCommandExecutor = {
      run: vi.fn().mockResolvedValue({ exitCode: 1, stderr: "boom" })
    };

    await expect(
      runSetupPipeline(
        [
          {
            name: "repo-a",
            path: "/workspace/repo-a",
            setup_pre_command: "echo pre",
            setup_command: "npm ci",
            setup_wrapper_command: "",
            setup_env: {}
          },
          {
            name: "repo-b",
            path: "/workspace/repo-b",
            setup_pre_command: "",
            setup_command: "npm ci",
            setup_wrapper_command: "",
            setup_env: {}
          }
        ],
        executor,
        {
          continueOnError: false
        }
      )
    ).rejects.toThrow("Setup pipeline failed");

    expect(executor.run).toHaveBeenCalledTimes(1);
  });

  it("continues when continueOnError is true", async () => {
    const executor: SetupCommandExecutor = {
      run: vi
        .fn()
        .mockResolvedValueOnce({ exitCode: 1, stderr: "first repo failed" })
        .mockResolvedValueOnce({ exitCode: 0 })
    };

    const result = await runSetupPipeline(
      [
        {
          name: "repo-a",
          path: "/workspace/repo-a",
          setup_pre_command: "",
          setup_command: "npm ci",
          setup_wrapper_command: "",
          setup_env: {}
        },
        {
          name: "repo-b",
          path: "/workspace/repo-b",
          setup_pre_command: "",
          setup_command: "pnpm i",
          setup_wrapper_command: "",
          setup_env: {}
        }
      ],
      executor,
      {
        continueOnError: true
      }
    );

    expect(result.success).toBe(false);
    expect(result.repos).toHaveLength(2);
    expect(result.repos[0].success).toBe(false);
    expect(result.repos[1].success).toBe(true);
    expect(executor.run).toHaveBeenCalledTimes(2);
  });
});
