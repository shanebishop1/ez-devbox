import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

interface PackageJsonScriptsShape {
  scripts?: Record<string, string>;
}

describe("package scripts", () => {
  it("includes live e2e smoke in validate", () => {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const parsed = JSON.parse(raw) as PackageJsonScriptsShape;
    const validateScript = parsed.scripts?.validate;

    expect(validateScript).toContain("npm run e2e:live");
  });
});
