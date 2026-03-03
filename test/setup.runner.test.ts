import { describe, expect, it, vi } from "vitest";
import { runSetupPipeline, type SetupCommandExecutor } from "../src/setup/runner.js";

describe("setup runner", () => {
  it("retries failed step and then succeeds", async () => {
    const sleep = vi.fn().mockResolvedValue(undefined);
    const events: string[] = [];
    let setupAttempts = 0;

    const executor: SetupCommandExecutor = {
      run: vi.fn().mockImplementation(async (command, options) => {
        setupAttempts += 1;
        options.onStdoutLine?.(`setup attempt ${setupAttempts}`);
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
          setup_command: "npm ci",
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
      1,
      "npm ci",
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
            setup_command: "npm ci",
            setup_env: {}
          },
          {
            name: "repo-b",
            path: "/workspace/repo-b",
            setup_command: "npm ci",
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
          setup_command: "npm ci",
          setup_env: {}
        },
        {
          name: "repo-b",
          path: "/workspace/repo-b",
          setup_command: "pnpm i",
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

  it("runs setup across repos with bounded parallelism and stable result order", async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const executor: SetupCommandExecutor = {
      run: vi.fn().mockImplementation(async (_command, options) => {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 10));
        inFlight -= 1;
        return { exitCode: 0, stdout: options.cwd };
      })
    };

    const repos = [
      { name: "repo-a", path: "/workspace/repo-a", setup_command: "npm ci", setup_env: {} },
      { name: "repo-b", path: "/workspace/repo-b", setup_command: "npm ci", setup_env: {} },
      { name: "repo-c", path: "/workspace/repo-c", setup_command: "npm ci", setup_env: {} },
      { name: "repo-d", path: "/workspace/repo-d", setup_command: "npm ci", setup_env: {} }
    ];

    const result = await runSetupPipeline(repos, executor, { maxConcurrency: 2 });

    expect(result.success).toBe(true);
    expect(maxInFlight).toBe(2);
    expect(result.repos.map((entry) => entry.repo)).toEqual(["repo-a", "repo-b", "repo-c", "repo-d"]);
  });

  it("stops scheduling additional repos when fail-fast is enabled with concurrency", async () => {
    const startedRepos: string[] = [];
    const executor: SetupCommandExecutor = {
      run: vi.fn().mockImplementation(async (_command, options) => {
        startedRepos.push(options.cwd);
        if (options.cwd.endsWith("repo-a")) {
          return { exitCode: 1, stderr: "boom" };
        }

        await new Promise((resolve) => setTimeout(resolve, 10));
        return { exitCode: 0 };
      })
    };

    await expect(
      runSetupPipeline(
        [
          { name: "repo-a", path: "/workspace/repo-a", setup_command: "npm ci", setup_env: {} },
          { name: "repo-b", path: "/workspace/repo-b", setup_command: "npm ci", setup_env: {} },
          { name: "repo-c", path: "/workspace/repo-c", setup_command: "npm ci", setup_env: {} }
        ],
        executor,
        {
          continueOnError: false,
          maxConcurrency: 2
        }
      )
    ).rejects.toThrow("Setup pipeline failed");

    expect(startedRepos).toContain("/workspace/repo-a");
    expect(startedRepos).toContain("/workspace/repo-b");
    expect(startedRepos).not.toContain("/workspace/repo-c");
  });

  it("rejects invalid maxConcurrency values", async () => {
    const executor: SetupCommandExecutor = {
      run: vi.fn().mockResolvedValue({ exitCode: 0 })
    };

    await expect(
      runSetupPipeline(
        [{ name: "repo-a", path: "/workspace/repo-a", setup_command: "npm ci", setup_env: {} }],
        executor,
        { maxConcurrency: 0 }
      )
    ).rejects.toThrow("maxConcurrency");
  });
});
