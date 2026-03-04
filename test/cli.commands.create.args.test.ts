import { describe, expect, it } from "vitest";
import { parseCreateArgs } from "../src/cli/commands.create.args.js";

describe("parseCreateArgs", () => {
  it("parses --mode and --json", () => {
    expect(parseCreateArgs(["--mode", "web", "--json"])).toEqual({ mode: "web", json: true });
  });

  it("accepts legacy --yes-sync", () => {
    expect(parseCreateArgs(["--yes-sync"])).toEqual({ mode: undefined, json: false });
  });

  it("rejects unknown options", () => {
    expect(() => parseCreateArgs(["--bad"])).toThrow("Unknown option for create: '--bad'. Use --help for usage.");
  });

  it("rejects unexpected positional arguments", () => {
    expect(() => parseCreateArgs(["hello"])).toThrow(
      "Unexpected positional argument for create: 'hello'. Use --help for usage.",
    );
  });
});
