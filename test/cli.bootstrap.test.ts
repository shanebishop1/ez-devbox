import { describe, expect, it } from "vitest";
import { resolveCliCommand } from "../src/cli/router.js";

describe("CLI bootstrap routing", () => {
  it("routes known command with passthrough args", () => {
    const resolved = resolveCliCommand(["create", "--name", "demo"]);

    expect(resolved.command).toBe("create");
    expect(resolved.args).toEqual(["--name", "demo"]);
  });
});
