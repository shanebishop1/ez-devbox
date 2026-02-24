import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadCliEnvSource } from "../src/cli/env-source.js";

describe("loadCliEnvSource", () => {
  let tempDir = "";
  let originalEnvValue: string | undefined;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "agent-box-env-source-"));
    originalEnvValue = process.env.EZ_DEVBOX_TEST_ENV_SOURCE;
    delete process.env.EZ_DEVBOX_TEST_ENV_SOURCE;
  });

  afterEach(async () => {
    if (originalEnvValue === undefined) {
      delete process.env.EZ_DEVBOX_TEST_ENV_SOURCE;
    } else {
      process.env.EZ_DEVBOX_TEST_ENV_SOURCE = originalEnvValue;
    }

    await rm(tempDir, {
      recursive: true,
      force: true
    });
  });

  it("loads values from .env when process env is missing", async () => {
    const envPath = join(tempDir, ".env");
    await writeFile(envPath, "EZ_DEVBOX_TEST_ENV_SOURCE=from-file\n");

    const result = await loadCliEnvSource(envPath);

    expect(result.EZ_DEVBOX_TEST_ENV_SOURCE).toBe("from-file");
  });

  it("prefers process env values over .env", async () => {
    const envPath = join(tempDir, ".env");
    await writeFile(envPath, "EZ_DEVBOX_TEST_ENV_SOURCE=from-file\n");
    process.env.EZ_DEVBOX_TEST_ENV_SOURCE = "from-process";

    const result = await loadCliEnvSource(envPath);

    expect(result.EZ_DEVBOX_TEST_ENV_SOURCE).toBe("from-process");
  });

  it("ignores missing .env files", async () => {
    process.env.EZ_DEVBOX_TEST_ENV_SOURCE = "from-process";

    const result = await loadCliEnvSource(join(tempDir, "missing.env"));

    expect(result.EZ_DEVBOX_TEST_ENV_SOURCE).toBe("from-process");
  });

  it("throws for non-ENOENT read failures", async () => {
    await expect(loadCliEnvSource(tempDir)).rejects.toThrow();
  });
});
