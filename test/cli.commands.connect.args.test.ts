import { describe, expect, it } from "vitest";
import { parseConnectArgs } from "../src/cli/commands.connect.args.js";

describe("parseConnectArgs", () => {
  it("parses --sandbox-id, --mode, and --json", () => {
    expect(parseConnectArgs(["--sandbox-id", "sbx-1", "--mode", "ssh-codex", "--json"])).toEqual({
      sandboxId: "sbx-1",
      mode: "ssh-codex",
      json: true,
    });
  });

  it("requires value for --sandbox-id", () => {
    expect(() => parseConnectArgs(["--sandbox-id"])).toThrow("Missing value for --sandbox-id.");
  });

  it("rejects unknown options", () => {
    expect(() => parseConnectArgs(["--bad"])).toThrow("Unknown option for connect: '--bad'. Use --help for usage.");
  });

  it("rejects unexpected positional arguments", () => {
    expect(() => parseConnectArgs(["extra"])).toThrow(
      "Unexpected positional argument for connect: 'extra'. Use --help for usage.",
    );
  });
});
