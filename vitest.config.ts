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
  },
});
