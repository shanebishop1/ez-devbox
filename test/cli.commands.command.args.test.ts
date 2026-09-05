import { describe, expect, it } from "vitest";
import { parseCommandArgs } from "../src/cli/commands.command.args.js";

describe("parseCommandArgs", () => {
  it("parses options and remote command", () => {
    expect(parseCommandArgs(["--sandbox-id", "sbx-1", "--json", "--", "npm", "test"])).toEqual({
      sandboxId: "sbx-1",
      invocation: { kind: "argv", argv: ["npm", "test"] },
      json: true,
      timeoutMs: undefined,
    });
  });

  it("rejects missing --sandbox-id value", () => {
    expect(() => parseCommandArgs(["--sandbox-id"])).toThrow("Missing value for --sandbox-id.");
  });

  it("rejects unknown options", () => {
    expect(() => parseCommandArgs(["--bad", "echo", "hi"])).toThrow(
      "Unknown option for command: '--bad'. Use --help for usage.",
    );
  });

  it("rejects missing remote command", () => {
    expect(() => parseCommandArgs(["--sandbox-id", "sbx-1"])).toThrow(
      "Missing remote command. Provide argv after --, or use --shell/--shell-file.",
    );
  });

  it("keeps argv boundaries and parses timeouts", () => {
    expect(parseCommandArgs(["--timeout-ms", "1234", "--", "printf", "%s", "a b"])).toMatchObject({
      invocation: { kind: "argv", argv: ["printf", "%s", "a b"] },
      timeoutMs: 1234,
    });
  });
});
