import { describe, expect, it } from "vitest";
import { parseCommandArgs } from "../src/cli/commands.command.args.js";

describe("parseCommandArgs", () => {
  it("parses options and remote command", () => {
    expect(parseCommandArgs(["--sandbox-id", "sbx-1", "--json", "--", "npm", "test"])).toEqual({
      sandboxId: "sbx-1",
      command: "npm test",
      json: true,
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
      "Missing remote command. Provide a command after options (use -- when needed).",
    );
  });
});
