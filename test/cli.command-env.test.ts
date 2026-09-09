import { describe, expect, it } from "vitest";
import { resolveGhRuntimeEnv } from "../src/cli/command-env.js";
import { resolveGhRuntimeEnv as resolveConnectGhRuntimeEnv } from "../src/cli/commands.connect.env.js";
import {
  formatEnvVarNames,
  hasPublicTunnelRuntimeEnv,
  resolveGhRuntimeEnv as resolveCreateGhRuntimeEnv,
} from "../src/cli/commands.create.env.js";

describe("command environment compatibility", () => {
  it("preserves the command-specific environment entry points", () => {
    expect(resolveCreateGhRuntimeEnv).toBe(resolveGhRuntimeEnv);
    expect(resolveConnectGhRuntimeEnv).toBe(resolveGhRuntimeEnv);
    expect(formatEnvVarNames({ GH_TOKEN: "secret" })).toBe("GH_TOKEN");
  });

  it("detects only public tunnel URL variables", () => {
    expect(hasPublicTunnelRuntimeEnv({ EZ_DEVBOX_TUNNEL_3000_URL: "https://example.com" })).toBe(true);
    expect(hasPublicTunnelRuntimeEnv({ EZ_DEVBOX_TUNNEL_3000_TOKEN: "secret" })).toBe(false);
    expect(hasPublicTunnelRuntimeEnv({ OTHER_URL: "https://example.com" })).toBe(false);
  });
});
