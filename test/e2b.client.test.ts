import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  connect: vi.fn(),
  create: vi.fn(),
  kill: vi.fn(),
  list: vi.fn(),
}));

vi.mock("e2b", () => ({
  Sandbox: sdk,
}));

import { createE2BClient } from "../src/e2b/client.js";

describe("E2B SDK client", () => {
  beforeEach(() => {
    sdk.connect.mockReset();
    sdk.create.mockReset();
    sdk.kill.mockReset();
    sdk.list.mockReset();
  });

  it("forwards create and connect options to the E2B SDK", async () => {
    const sandbox = { sandboxId: "sbx-123" };
    sdk.create.mockResolvedValue(sandbox);
    sdk.connect.mockResolvedValue(sandbox);
    const client = createE2BClient();

    await expect(
      client.create("opencode", {
        timeoutMs: 60_000,
        metadata: { source: "test" },
        envs: { GITHUB_TOKEN: "token" },
        requestTimeoutMs: 10_000,
      }),
    ).resolves.toBe(sandbox);
    await expect(client.connect("sbx-123", { requestTimeoutMs: 5_000 })).resolves.toBe(sandbox);

    expect(sdk.create).toHaveBeenCalledWith("opencode", {
      timeoutMs: 60_000,
      metadata: { source: "test" },
      envs: { GITHUB_TOKEN: "token" },
      requestTimeoutMs: 10_000,
    });
    expect(sdk.connect).toHaveBeenCalledWith("sbx-123", { requestTimeoutMs: 5_000 });
  });

  it("collects every page returned by the E2B v2 sandbox paginator", async () => {
    let page = 0;
    const nextItems = vi.fn(async () => {
      page += 1;
      return page === 1
        ? [{ sandboxId: "sbx-1", state: "running", metadata: { source: "test" } }]
        : [{ sandboxId: "sbx-2", state: "paused", metadata: undefined }];
    });
    const paginator = {
      get hasNext() {
        return page < 2;
      },
      nextItems,
    };
    sdk.list.mockReturnValue(paginator);
    const client = createE2BClient();

    await expect(client.list({ metadata: { source: "test" }, requestTimeoutMs: 5_000 })).resolves.toEqual([
      { sandboxId: "sbx-1", state: "running", metadata: { source: "test" } },
      { sandboxId: "sbx-2", state: "paused", metadata: undefined },
    ]);

    expect(sdk.list).toHaveBeenCalledWith({
      query: { metadata: { source: "test" } },
      requestTimeoutMs: 5_000,
    });
    expect(nextItems).toHaveBeenCalledTimes(2);
  });

  it("preserves the E2B v2 deletion result", async () => {
    sdk.kill.mockResolvedValue(false);
    const client = createE2BClient();

    await expect(client.kill("sbx-missing", { requestTimeoutMs: 5_000 })).resolves.toBe(false);
    expect(sdk.kill).toHaveBeenCalledWith("sbx-missing", { requestTimeoutMs: 5_000 });
  });
});
