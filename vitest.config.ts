import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineConfig } from "vitest/config";

const isolatedHome = join(tmpdir(), `ez-devbox-vitest-isolated-home-${process.pid}`);

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    env: {
      HOME: isolatedHome,
      XDG_CONFIG_HOME: join(isolatedHome, ".config"),
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.types.ts", "src/types/**"],
      thresholds: {
        branches: 70,
        functions: 80,
        lines: 75,
        statements: 75,
      },
    },
  },
});
