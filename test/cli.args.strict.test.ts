import { describe, expect, it, vi } from "vitest";
import { runCommandCommand } from "../src/cli/commands.command.js";
import { runConnectCommand } from "../src/cli/commands.connect.js";
import { runCreateCommand } from "../src/cli/commands.create.js";
import { runListCommand } from "../src/cli/commands.list.js";
import { runResumeCommand } from "../src/cli/commands.resume.js";
import { runWipeAllCommand } from "../src/cli/commands.wipe-all.js";
import { runWipeCommand } from "../src/cli/commands.wipe.js";
import { parseGlobalCliOptions } from "../src/cli/router.js";

describe("strict CLI argument parsing", () => {
  it.each([
    { label: "create", run: () => runCreateCommand(["--bad-flag"]) },
    { label: "connect", run: () => runConnectCommand(["--bad-flag"]) },
    { label: "command", run: () => runCommandCommand(["--bad-flag", "echo", "hi"]) },
    { label: "wipe", run: () => runWipeCommand(["--bad-flag"]) },
    { label: "wipe-all", run: () => runWipeAllCommand(["--bad-flag"]) },
    { label: "list", run: () => runListCommand(["--bad-flag"]) },
    { label: "resume", run: () => runResumeCommand(["--bad-flag"]) }
  ])("rejects unknown flags for $label", async ({ run }) => {
    await expect(run()).rejects.toThrow("Use --help for usage");
  });

  it("keeps command payload parsing after -- intact", async () => {
    const run = vi.fn().mockResolvedValue({ stdout: "ok", stderr: "", exitCode: 0 });

    const result = await runCommandCommand(["--sandbox-id", "sbx-1", "--", "--version"], {
      loadConfig: vi.fn().mockResolvedValue({
        sandbox: {
          template: "base",
          reuse: true,
          name: "ez-devbox",
          timeout_ms: 1_800_000,
          delete_on_exit: false
        },
        startup: {
          mode: "prompt"
        },
        project: {
          mode: "single",
          active: "prompt",
          dir: "/workspace",
          working_dir: "auto",
          setup_on_connect: false,
          setup_retries: 0,
          setup_concurrency: 1,
          setup_continue_on_error: false,
          repos: []
        },
        env: {
          pass_through: []
        },
        opencode: {
          config_dir: "~/.config/opencode",
          auth_path: "~/.local/share/opencode/auth.json"
        },
        codex: {
          config_dir: "~/.codex",
          auth_path: "~/.codex/auth.json"
        },
        gh: {
          enabled: false,
          config_dir: "~/.config/gh"
        },
        tunnel: {
          ports: []
        }
      }),
      listSandboxes: vi.fn().mockResolvedValue([]),
      connectSandbox: vi.fn().mockResolvedValue({ sandboxId: "sbx-1", run }),
      loadLastRunState: vi.fn().mockResolvedValue(null)
    });

    expect(run).toHaveBeenCalledWith("--version", { cwd: "/workspace" });
    expect(result.exitCode).toBe(0);
  });

  it("rejects unknown global option before command", () => {
    expect(() => parseGlobalCliOptions(["--bad-flag", "list"])).toThrow(
      "Unknown global option: --bad-flag. Use --help for usage."
    );
  });

  it("allows --json for list and command", async () => {
    await expect(
      runListCommand(["--json"], {
        listSandboxes: vi.fn().mockResolvedValue([])
      })
    ).resolves.toBeDefined();

    const run = vi.fn().mockResolvedValue({ stdout: "", stderr: "", exitCode: 0 });
    await expect(
      runCommandCommand(["--sandbox-id", "sbx-1", "--json", "--", "pwd"], {
        loadConfig: vi.fn().mockResolvedValue({
          sandbox: {
            template: "base",
            reuse: true,
            name: "ez-devbox",
            timeout_ms: 1_800_000,
            delete_on_exit: false
          },
          startup: {
            mode: "prompt"
          },
          project: {
            mode: "single",
            active: "prompt",
            dir: "/workspace",
            working_dir: "auto",
            setup_on_connect: false,
            setup_retries: 0,
            setup_concurrency: 1,
            setup_continue_on_error: false,
            repos: []
          },
          env: {
            pass_through: []
          },
          opencode: {
            config_dir: "~/.config/opencode",
            auth_path: "~/.local/share/opencode/auth.json"
          },
          codex: {
            config_dir: "~/.codex",
            auth_path: "~/.codex/auth.json"
          },
          gh: {
            enabled: false,
            config_dir: "~/.config/gh"
          },
          tunnel: {
            ports: []
          }
        }),
        listSandboxes: vi.fn().mockResolvedValue([]),
        connectSandbox: vi.fn().mockResolvedValue({ sandboxId: "sbx-1", run }),
        loadLastRunState: vi.fn().mockResolvedValue(null)
      })
    ).resolves.toBeDefined();
  });
});
