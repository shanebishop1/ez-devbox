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

  it("enforces source coverage in offline validation", () => {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const parsed = JSON.parse(raw) as PackageJsonScriptsShape;

    expect(parsed.scripts?.["validate:offline"]).toContain("npm run test:coverage");
  });

  it("smoke-tests installed package bins during package verification", () => {
    const raw = readFileSync(new URL("../package.json", import.meta.url), "utf8");
    const parsed = JSON.parse(raw) as PackageJsonScriptsShape;

    expect(parsed.scripts?.["pack:check"]).toContain("verify-installed-package.ts");
  });
});
