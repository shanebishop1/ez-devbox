import { afterEach, describe, expect, it, vi } from "vitest";
import type { CommandResult } from "../src/types/index.js";

const commandMocks = vi.hoisted(() => ({
  create: vi.fn(),
  connect: vi.fn(),
  list: vi.fn(),
  command: vi.fn(),
}));

vi.mock("../src/cli/commands.create.js", () => ({ runCreateCommand: commandMocks.create }));
vi.mock("../src/cli/commands.connect.js", () => ({ runConnectCommand: commandMocks.connect }));
vi.mock("../src/cli/commands.list.js", () => ({ runListCommand: commandMocks.list }));
vi.mock("../src/cli/commands.command.js", () => ({ runCommandCommand: commandMocks.command }));

import { runCli } from "../src/cli/index.js";
import { renderHelp } from "../src/cli/router.js";
import { StructuredCliError } from "../src/cli/structured-error.js";
import { readCliVersion } from "../src/cli/version.js";
import { logger } from "../src/logging/logger.js";

describe("CLI process JSON output", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it.each([
    ["create", ["create", "--json"], commandMocks.create],
    ["connect", ["connect", "--json"], commandMocks.connect],
    ["list", ["list", "--json"], commandMocks.list],
    ["command", ["command", "--json", "--", "true"], commandMocks.command],
  ] as const)("writes only the %s JSON payload to stdout", async (_name, argv, commandMock) => {
    const payload = { ok: true, command: argv[0] };
    commandMock.mockImplementationOnce(async (): Promise<CommandResult> => {
      logger.info("progress info");
      logger.verbose("progress verbose");
      logger.warn("progress warning");
      const stop = logger.startLoading("progress loading");
      stop();
      return { message: JSON.stringify(payload), exitCode: 0, json: true };
    });
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);

    const exitCode = await runCli(["--verbose", ...argv]);

    expect(exitCode).toBe(0);
    expect(stdout).toHaveBeenCalledTimes(1);
    expect(stdout).toHaveBeenCalledWith(`${JSON.stringify(payload)}\n`);
    expect(consoleLog).not.toHaveBeenCalled();
  });

  it("returns a JSON error envelope without stderr contamination", async () => {
    commandMocks.list.mockRejectedValueOnce(new Error("list failed E2B_API_KEY=secret"));
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const exitCode = await runCli(["list", "--json", "--bad"]);

    expect(exitCode).toBe(1);
    expect(stdout).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(stdout.mock.calls[0]?.[0]))).toEqual({
      error: {
        code: "CLI_ERROR",
        stage: "cli",
        message: "list failed E2B_API_KEY=[REDACTED]",
      },
    });
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("preserves stable error stage and sandbox id", async () => {
    commandMocks.connect.mockRejectedValueOnce(
      new StructuredCliError("AGENT_START_FAILED", "agent-startup", "tmux failed", { sandboxId: "sbx-1" }),
    );
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    expect(await runCli(["connect", "--json", "--sandbox-id", "sbx-1"])).toBe(1);
    expect(JSON.parse(String(stdout.mock.calls[0]?.[0]))).toEqual({
      error: { code: "AGENT_START_FAILED", stage: "agent-startup", message: "tmux failed", sandboxId: "sbx-1" },
    });
  });
});

describe("CLI direct output", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each([
    ["help", ["--help"], renderHelp],
    ["version", ["--version"], readCliVersion],
  ] as const)("writes %s to stdout without routing through the logger", async (_name, argv, renderOutput) => {
    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const loggerInfo = vi.spyOn(logger, "info").mockImplementation(() => undefined);

    const exitCode = await runCli([...argv]);

    expect(exitCode).toBe(0);
    expect(stdout).toHaveBeenCalledOnce();
    expect(stdout).toHaveBeenCalledWith(`${renderOutput()}\n`);
    expect(loggerInfo).not.toHaveBeenCalled();
  });
});
