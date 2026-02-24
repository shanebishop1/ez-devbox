import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runConnectCommand } from "../src/cli/commands.connect.js";
import { runCreateCommand, syncToolingForMode as syncToolingForCreateMode } from "../src/cli/commands.create.js";
import { PromptCancelledError } from "../src/cli/prompt-cancelled.js";
import { buildSandboxDisplayName } from "../src/cli/sandbox-display-name.js";
import type { ResolvedLauncherConfig } from "../src/config/schema.js";
import { logger, setVerboseLoggingEnabled } from "../src/logging/logger.js";

describe("CLI command integration", () => {
  const tempRoots: string[] = [];

  async function createTempRoot(prefix: string): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), `agent-box-cli-${prefix}-`));
    tempRoots.push(root);
    return root;
  }

  afterEach(async () => {
    await Promise.all(tempRoots.map((dir) => rm(dir, { recursive: true, force: true })));
    tempRoots.length = 0;
    setVerboseLoggingEnabled(false);
  });

  const syncSummary = {
    totalDiscovered: 2,
    totalWritten: 2,
    skippedMissingPaths: 0,
    opencodeConfigSynced: true,
    opencodeAuthSynced: true,
    codexConfigSynced: false,
    codexAuthSynced: false,
    ghEnabled: false,
    ghConfigSynced: false
  };
  const bootstrapResult = {
    selectedRepoNames: [],
    workingDirectory: undefined,
    startupEnv: {},
    provisionedRepos: [],
    setup: null
  };

  const config: ResolvedLauncherConfig = {
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
      setup_retries: 2,
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
  };

  it("create resolves prompt mode using injected selector before template sync/launch", async () => {
    setVerboseLoggingEnabled(true);
    const loggerVerbose = vi.spyOn(logger, "verbose").mockImplementation(() => undefined);
    const createSandbox = vi.fn().mockResolvedValue({ sandboxId: "sbx-created" });
    const launchMode = vi.fn().mockResolvedValue({ mode: "ssh-codex", command: "codex", message: "launched" });
    const syncToolingToSandbox = vi.fn().mockResolvedValue(syncSummary);
    const saveLastRunState = vi.fn().mockResolvedValue(undefined);
    const resolvePromptStartupMode = vi.fn().mockResolvedValue("ssh-codex");
    const displayName = buildSandboxDisplayName(config.project.repos, "2026-02-01T00:00:00.000Z");

    const result = await runCreateCommand([], {
      loadConfig: vi.fn().mockResolvedValue(config),
      createSandbox,
      resolveEnvSource: vi.fn().mockResolvedValue({}),
      resolveSandboxCreateEnv: vi.fn().mockReturnValue({ envs: {} }),
      resolvePromptStartupMode,
      launchMode,
      bootstrapProjectWorkspace: vi.fn().mockResolvedValue(bootstrapResult),
      syncToolingToSandbox,
      saveLastRunState,
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(createSandbox).toHaveBeenCalledTimes(1);
    expect(resolvePromptStartupMode).toHaveBeenCalledWith("prompt");
    expect(createSandbox).toHaveBeenCalledWith(
      {
        ...config,
        sandbox: {
          ...config.sandbox,
          template: "codex"
        }
      },
      {
        envs: {},
        metadata: {
          "launcher.name": displayName
        }
      }
    );
    expect(syncToolingToSandbox).toHaveBeenCalledWith(config, { sandboxId: "sbx-created" }, "ssh-codex");
    expect(syncToolingToSandbox.mock.invocationCallOrder[0]).toBeLessThan(launchMode.mock.invocationCallOrder[0]);
    expect(launchMode).toHaveBeenCalledWith({ sandboxId: "sbx-created" }, "ssh-codex", {
      workingDirectory: undefined,
      startupEnv: {}
    });
    expect(loggerVerbose).toHaveBeenCalledWith("Startup mode selected via prompt: ssh-codex.");
    expect(saveLastRunState).toHaveBeenCalledWith({
      sandboxId: "sbx-created",
      mode: "ssh-codex",
      activeRepo: undefined,
      updatedAt: "2026-02-01T00:00:00.000Z"
    });
    expect(result.message).toContain(`Created sandbox ${displayName} (sbx-created).`);
    loggerVerbose.mockRestore();
  });

  it("create skips tooling sync when user declines interactive confirmation", async () => {
    const syncToolingToSandbox = vi.fn().mockResolvedValue(syncSummary);
    const promptInput = vi.fn().mockResolvedValue("n");

    const result = await runCreateCommand(["--mode", "ssh-opencode"], {
      loadConfig: vi.fn().mockResolvedValue(config),
      createSandbox: vi.fn().mockResolvedValue({ sandboxId: "sbx-created" }),
      resolveEnvSource: vi.fn().mockResolvedValue({}),
      resolveSandboxCreateEnv: vi.fn().mockReturnValue({ envs: {} }),
      resolvePromptStartupMode: vi.fn().mockResolvedValue("ssh-opencode"),
      launchMode: vi.fn().mockResolvedValue({ mode: "ssh-opencode", command: "opencode", message: "launched" }),
      bootstrapProjectWorkspace: vi.fn().mockResolvedValue(bootstrapResult),
      syncToolingToSandbox,
      isInteractiveTerminal: () => true,
      promptInput,
      saveLastRunState: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(promptInput).toHaveBeenCalledWith("Sync local tooling auth/config into sandbox now? [Y/n]: ");
    expect(syncToolingToSandbox).not.toHaveBeenCalled();
    expect(result.message).toContain("Tooling sync: skipped by user");
  });

  it("create --yes-sync bypasses interactive tooling sync confirmation", async () => {
    const syncToolingToSandbox = vi.fn().mockResolvedValue(syncSummary);
    const promptInput = vi.fn().mockResolvedValue("n");

    await runCreateCommand(["--mode", "ssh-opencode", "--yes-sync"], {
      loadConfig: vi.fn().mockResolvedValue(config),
      createSandbox: vi.fn().mockResolvedValue({ sandboxId: "sbx-created" }),
      resolveEnvSource: vi.fn().mockResolvedValue({}),
      resolveSandboxCreateEnv: vi.fn().mockReturnValue({ envs: {} }),
      resolvePromptStartupMode: vi.fn().mockResolvedValue("ssh-opencode"),
      launchMode: vi.fn().mockResolvedValue({ mode: "ssh-opencode", command: "opencode", message: "launched" }),
      bootstrapProjectWorkspace: vi.fn().mockResolvedValue(bootstrapResult),
      syncToolingToSandbox,
      isInteractiveTerminal: () => true,
      promptInput,
      saveLastRunState: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(promptInput).not.toHaveBeenCalled();
    expect(syncToolingToSandbox).toHaveBeenCalledTimes(1);
  });

  it("create keeps tooling sync enabled in non-interactive mode without prompt", async () => {
    const syncToolingToSandbox = vi.fn().mockResolvedValue(syncSummary);
    const promptInput = vi.fn().mockResolvedValue("n");

    await runCreateCommand(["--mode", "ssh-opencode"], {
      loadConfig: vi.fn().mockResolvedValue(config),
      createSandbox: vi.fn().mockResolvedValue({ sandboxId: "sbx-created" }),
      resolveEnvSource: vi.fn().mockResolvedValue({}),
      resolveSandboxCreateEnv: vi.fn().mockReturnValue({ envs: {} }),
      resolvePromptStartupMode: vi.fn().mockResolvedValue("ssh-opencode"),
      launchMode: vi.fn().mockResolvedValue({ mode: "ssh-opencode", command: "opencode", message: "launched" }),
      bootstrapProjectWorkspace: vi.fn().mockResolvedValue(bootstrapResult),
      syncToolingToSandbox,
      isInteractiveTerminal: () => false,
      promptInput,
      saveLastRunState: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(promptInput).not.toHaveBeenCalled();
    expect(syncToolingToSandbox).toHaveBeenCalledTimes(1);
  });

  it("create logs the launcher config path when metadata loader is used", async () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => undefined);

    await runCreateCommand(["--mode", "ssh-opencode"], {
      loadConfig: vi.fn().mockResolvedValue(config),
      loadConfigWithMetadata: vi.fn().mockResolvedValue({
        config,
        configPath: "/tmp/launcher.config.toml",
        createdConfig: false,
        scope: "local"
      }),
      createSandbox: vi.fn().mockResolvedValue({ sandboxId: "sbx-created" }),
      resolveEnvSource: vi.fn().mockResolvedValue({}),
      resolveSandboxCreateEnv: vi.fn().mockReturnValue({ envs: {} }),
      resolvePromptStartupMode: vi.fn().mockResolvedValue("ssh-opencode"),
      launchMode: vi.fn().mockResolvedValue({ mode: "ssh-opencode", command: "opencode", message: "launched" }),
      bootstrapProjectWorkspace: vi.fn().mockResolvedValue(bootstrapResult),
      syncToolingToSandbox: vi.fn().mockResolvedValue(syncSummary),
      saveLastRunState: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(infoSpy).toHaveBeenCalledWith("Using launcher config: /tmp/launcher.config.toml");
    infoSpy.mockRestore();
  });

  it("create auto-selects codex template for ssh-codex mode", async () => {
    const createSandbox = vi.fn().mockResolvedValue({ sandboxId: "sbx-created" });
    const syncToolingToSandbox = vi.fn().mockResolvedValue({
      ...syncSummary,
      opencodeConfigSynced: false,
      opencodeAuthSynced: false,
      codexConfigSynced: true,
      codexAuthSynced: true
    });
    const resolvePromptStartupMode = vi.fn().mockImplementation(async (mode: string) => mode);
    const displayName = buildSandboxDisplayName(config.project.repos, "2026-02-01T00:00:00.000Z");

    await runCreateCommand(["--mode", "ssh-codex"], {
      loadConfig: vi.fn().mockResolvedValue(config),
      createSandbox,
      resolveEnvSource: vi.fn().mockResolvedValue({}),
      resolveSandboxCreateEnv: vi.fn().mockReturnValue({ envs: {} }),
      resolvePromptStartupMode,
      launchMode: vi.fn().mockResolvedValue({ mode: "ssh-codex", command: "codex", message: "launched" }),
      bootstrapProjectWorkspace: vi.fn().mockResolvedValue(bootstrapResult),
      syncToolingToSandbox,
      saveLastRunState: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(resolvePromptStartupMode).toHaveBeenCalledWith("ssh-codex");
    expect(createSandbox).toHaveBeenCalledWith(
      {
        ...config,
        sandbox: {
          ...config.sandbox,
          template: "codex"
        }
      },
      {
        envs: {},
        metadata: {
          "launcher.name": displayName
        }
      }
    );
    expect(syncToolingToSandbox).toHaveBeenCalledWith(config, { sandboxId: "sbx-created" }, "ssh-codex");
  });

  it("create uses single configured repo and branch in launcher.name metadata", async () => {
    const singleRepoConfig: ResolvedLauncherConfig = {
      ...config,
      project: {
        ...config.project,
        repos: [
          {
            name: "next.js",
            url: "https://github.com/vercel/next.js.git",
            branch: "canary",
            setup_command: "",
            setup_env: {},
            startup_env: {}
          }
        ]
      }
    };
    const createSandbox = vi.fn().mockResolvedValue({ sandboxId: "sbx-created" });

    await runCreateCommand(["--mode", "web"], {
      loadConfig: vi.fn().mockResolvedValue(singleRepoConfig),
      createSandbox,
      resolveEnvSource: vi.fn().mockResolvedValue({}),
      resolveSandboxCreateEnv: vi.fn().mockReturnValue({ envs: {} }),
      resolvePromptStartupMode: vi.fn().mockResolvedValue("web"),
      launchMode: vi.fn().mockResolvedValue({ mode: "web", url: "https://sbx-created.e2b.dev", message: "launched" }),
      bootstrapProjectWorkspace: vi.fn().mockResolvedValue(bootstrapResult),
      syncToolingToSandbox: vi.fn().mockResolvedValue(syncSummary),
      saveLastRunState: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(createSandbox).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        metadata: {
            "launcher.name": "next.js canary 2026-02-01 00:00:00 UTC"
        }
      })
    );
  });

  it("create uses only resolved sandbox env and does not auto-inject unrelated host env", async () => {
    const createSandbox = vi.fn().mockResolvedValue({ sandboxId: "sbx-created" });
    const launchMode = vi.fn().mockResolvedValue({ mode: "ssh-opencode", command: "opencode", message: "launched" });
    const syncToolingToSandbox = vi.fn().mockResolvedValue(syncSummary);
    const resolveEnvSource = vi.fn().mockResolvedValue({ FIRECRAWL_API_URL: "https://example.trycloudflare.com" });
    const resolveSandboxCreateEnv = vi.fn().mockReturnValue({ envs: {} });

    await runCreateCommand([], {
      loadConfig: vi.fn().mockResolvedValue(config),
      createSandbox,
      resolveEnvSource,
      resolveSandboxCreateEnv,
      resolvePromptStartupMode: vi.fn().mockResolvedValue("ssh-opencode"),
      launchMode,
      bootstrapProjectWorkspace: vi.fn().mockResolvedValue(bootstrapResult),
      syncToolingToSandbox,
      saveLastRunState: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(resolveEnvSource).toHaveBeenCalledTimes(1);
    expect(resolveSandboxCreateEnv).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ FIRECRAWL_API_URL: "https://example.trycloudflare.com" })
    );
    expect(createSandbox).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        envs: {}
      })
    );
    expect(launchMode).toHaveBeenCalledWith({ sandboxId: "sbx-created" }, "ssh-opencode", {
      workingDirectory: undefined,
      startupEnv: {}
    });
  });

  it("create injects GH token into sandbox create envs and launch startupEnv when gh is enabled", async () => {
    const ghEnabledConfig: ResolvedLauncherConfig = {
      ...config,
      gh: {
        ...config.gh,
        enabled: true
      }
    };
    const createSandbox = vi.fn().mockResolvedValue({ sandboxId: "sbx-created" });
    const launchMode = vi.fn().mockResolvedValue({ mode: "ssh-opencode", command: "opencode", message: "launched" });
    const resolveHostGhToken = vi.fn().mockResolvedValue("ghp_token");
    const bootstrapProjectWorkspace = vi.fn().mockResolvedValue({
      ...bootstrapResult,
      startupEnv: { NEXT_PUBLIC_APP_ENV: "preview" }
    });

    await runCreateCommand(["--mode", "ssh-opencode"], {
      loadConfig: vi.fn().mockResolvedValue(ghEnabledConfig),
      createSandbox,
      resolveEnvSource: vi.fn().mockResolvedValue({}),
      resolveSandboxCreateEnv: vi.fn().mockReturnValue({ envs: { OPENAI_API_KEY: "existing" } }),
      resolvePromptStartupMode: vi.fn().mockResolvedValue("ssh-opencode"),
      resolveHostGhToken,
      launchMode,
      bootstrapProjectWorkspace,
      syncToolingToSandbox: vi.fn().mockResolvedValue({ ...syncSummary, ghEnabled: true }),
      saveLastRunState: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(resolveHostGhToken).toHaveBeenCalledTimes(1);
    expect(createSandbox).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({
        envs: {
          OPENAI_API_KEY: "existing",
          GH_TOKEN: "ghp_token",
          GITHUB_TOKEN: "ghp_token"
        }
      })
    );
    expect(launchMode).toHaveBeenCalledWith({ sandboxId: "sbx-created" }, "ssh-opencode", {
      workingDirectory: undefined,
      startupEnv: {
        NEXT_PUBLIC_APP_ENV: "preview",
        OPENAI_API_KEY: "existing",
        GH_TOKEN: "ghp_token",
        GITHUB_TOKEN: "ghp_token"
      }
    });
  });

  it("create verbose logging lists only env var names", async () => {
    setVerboseLoggingEnabled(true);
    const loggerVerbose = vi.spyOn(logger, "verbose").mockImplementation(() => undefined);

    await runCreateCommand(["--mode", "ssh-opencode"], {
      loadConfig: vi.fn().mockResolvedValue(config),
      createSandbox: vi.fn().mockResolvedValue({ sandboxId: "sbx-created" }),
      resolveEnvSource: vi.fn().mockResolvedValue({}),
      resolveSandboxCreateEnv: vi.fn().mockReturnValue({
        envs: {
          OPENROUTER_API_KEY: "or-secret",
          OPENAI_API_KEY: "oa-secret"
        }
      }),
      resolvePromptStartupMode: vi.fn().mockResolvedValue("ssh-opencode"),
      launchMode: vi.fn().mockResolvedValue({ mode: "ssh-opencode", command: "opencode", message: "launched" }),
      bootstrapProjectWorkspace: vi.fn().mockResolvedValue(bootstrapResult),
      syncToolingToSandbox: vi.fn().mockResolvedValue(syncSummary),
      saveLastRunState: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-02-01T00:00:00.000Z"
    });

    const envLog = loggerVerbose.mock.calls
      .map(([message]) => message)
      .find((message) => message.startsWith("Creating sandbox with envs:"));

    expect(envLog).toBe("Creating sandbox with envs: OPENROUTER_API_KEY, OPENAI_API_KEY");
    expect(envLog).not.toContain("or-secret");
    expect(envLog).not.toContain("oa-secret");
    loggerVerbose.mockRestore();
  });

  it("create continues when gh is enabled but token is missing", async () => {
    const ghEnabledConfig: ResolvedLauncherConfig = {
      ...config,
      gh: {
        ...config.gh,
        enabled: true
      }
    };
    const createSandbox = vi.fn().mockResolvedValue({ sandboxId: "sbx-created" });
    const launchMode = vi.fn().mockResolvedValue({ mode: "ssh-opencode", command: "opencode", message: "launched" });

    const result = await runCreateCommand(["--mode", "ssh-opencode"], {
      loadConfig: vi.fn().mockResolvedValue(ghEnabledConfig),
      createSandbox,
      resolveEnvSource: vi.fn().mockResolvedValue({}),
      resolveSandboxCreateEnv: vi.fn().mockReturnValue({ envs: {} }),
      resolvePromptStartupMode: vi.fn().mockResolvedValue("ssh-opencode"),
      resolveHostGhToken: vi.fn().mockResolvedValue(undefined),
      launchMode,
      bootstrapProjectWorkspace: vi.fn().mockResolvedValue(bootstrapResult),
      syncToolingToSandbox: vi.fn().mockResolvedValue({ ...syncSummary, ghEnabled: true }),
      saveLastRunState: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(result.exitCode).toBe(0);
    expect(createSandbox).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ envs: {} }));
    expect(launchMode).toHaveBeenCalledWith({ sandboxId: "sbx-created" }, "ssh-opencode", {
      workingDirectory: undefined,
      startupEnv: {}
    });
  });

  it("create wipes newly created sandbox when setup selection is cancelled", async () => {
    setVerboseLoggingEnabled(true);
    const loggerVerbose = vi.spyOn(logger, "verbose").mockImplementation(() => undefined);
    const stopLoading = vi.fn();
    const startLoading = vi.spyOn(logger, "startLoading").mockReturnValue(stopLoading);
    const kill = vi.fn().mockResolvedValue(undefined);
    const createSandbox = vi.fn().mockResolvedValue({ sandboxId: "sbx-created", kill });

    await expect(
      runCreateCommand(["--mode", "ssh-opencode"], {
        loadConfig: vi.fn().mockResolvedValue(config),
        createSandbox,
        resolveEnvSource: vi.fn().mockResolvedValue({}),
        resolveSandboxCreateEnv: vi.fn().mockReturnValue({ envs: {} }),
        resolvePromptStartupMode: vi.fn().mockResolvedValue("ssh-opencode"),
        launchMode: vi.fn(),
        bootstrapProjectWorkspace: vi.fn().mockImplementation(async (_handle, _config, options) => {
          options?.onProgress?.("Repo clone: /workspace/alpha");
          throw new PromptCancelledError("Repository selection cancelled.");
        }),
        syncToolingToSandbox: vi.fn().mockResolvedValue(syncSummary),
        saveLastRunState: vi.fn().mockResolvedValue(undefined),
        now: () => "2026-02-01T00:00:00.000Z"
      })
    ).rejects.toThrow("was wiped");

    expect(createSandbox).toHaveBeenCalledTimes(1);
    expect(kill).toHaveBeenCalledTimes(1);
    expect(startLoading).toHaveBeenCalledWith("Bootstrapping...");
    expect(stopLoading).toHaveBeenCalledTimes(1);
    startLoading.mockRestore();
    expect(loggerVerbose).toHaveBeenCalledWith("Setup selection cancelled; wiping newly created sandbox.");
    loggerVerbose.mockRestore();
  });

  it("create does not wipe sandbox when cancellation happens before sandbox creation", async () => {
    const createSandbox = vi.fn();

    await expect(
      runCreateCommand([], {
        loadConfig: vi.fn().mockResolvedValue(config),
        createSandbox,
        resolveEnvSource: vi.fn().mockResolvedValue({}),
        resolveSandboxCreateEnv: vi.fn().mockReturnValue({ envs: {} }),
        resolvePromptStartupMode: vi.fn().mockRejectedValue(new PromptCancelledError("Startup mode selection cancelled.")),
        launchMode: vi.fn(),
        bootstrapProjectWorkspace: vi.fn().mockResolvedValue(bootstrapResult),
        syncToolingToSandbox: vi.fn().mockResolvedValue(syncSummary),
        saveLastRunState: vi.fn().mockResolvedValue(undefined),
        now: () => "2026-02-01T00:00:00.000Z"
      })
    ).rejects.toThrow("Startup mode selection cancelled.");

    expect(createSandbox).not.toHaveBeenCalled();
  });

  it("create does not auto-wipe on non-cancellation bootstrap errors", async () => {
    const stopLoading = vi.fn();
    const startLoading = vi.spyOn(logger, "startLoading").mockReturnValue(stopLoading);
    const kill = vi.fn().mockResolvedValue(undefined);

    await expect(
      runCreateCommand(["--mode", "ssh-opencode"], {
        loadConfig: vi.fn().mockResolvedValue(config),
        createSandbox: vi.fn().mockResolvedValue({ sandboxId: "sbx-created", kill }),
        resolveEnvSource: vi.fn().mockResolvedValue({}),
        resolveSandboxCreateEnv: vi.fn().mockReturnValue({ envs: {} }),
        resolvePromptStartupMode: vi.fn().mockResolvedValue("ssh-opencode"),
        launchMode: vi.fn(),
        bootstrapProjectWorkspace: vi.fn().mockImplementation(async (_handle, _config, options) => {
          options?.onProgress?.("Repo clone: /workspace/alpha");
          throw new Error("bootstrap failed");
        }),
        syncToolingToSandbox: vi.fn().mockResolvedValue(syncSummary),
        saveLastRunState: vi.fn().mockResolvedValue(undefined),
        now: () => "2026-02-01T00:00:00.000Z"
      })
    ).rejects.toThrow("bootstrap failed");

    expect(startLoading).toHaveBeenCalledWith("Bootstrapping...");
    expect(stopLoading).toHaveBeenCalledTimes(1);
    startLoading.mockRestore();
    expect(kill).not.toHaveBeenCalled();
  });

  it("create tooling sync includes gh only when enabled", async () => {
    const root = await createTempRoot("create-gh");
    const opencodeConfigDir = join(root, "opencode-config");
    const opencodeAuthPath = join(root, "opencode-auth.json");
    const ghConfigDir = join(root, "gh-config");

    await mkdir(opencodeConfigDir, { recursive: true });
    await mkdir(ghConfigDir, { recursive: true });
    await writeFile(join(opencodeConfigDir, "settings.toml"), "x=1", "utf8");
    await writeFile(opencodeAuthPath, "{}", "utf8");
    await writeFile(join(ghConfigDir, "hosts.yml"), "github.com:\n  user: test\n", "utf8");

    const writeFileInSandbox = vi.fn().mockResolvedValue(undefined);
    const summaryDisabled = await syncToolingForCreateMode(
      {
        ...config,
        opencode: { config_dir: opencodeConfigDir, auth_path: opencodeAuthPath },
        gh: { enabled: false, config_dir: ghConfigDir }
      },
      { writeFile: writeFileInSandbox },
      "ssh-opencode"
    );
    const summaryEnabled = await syncToolingForCreateMode(
      {
        ...config,
        opencode: { config_dir: opencodeConfigDir, auth_path: opencodeAuthPath },
        gh: { enabled: true, config_dir: ghConfigDir }
      },
      { writeFile: writeFileInSandbox },
      "ssh-opencode"
    );

    expect(summaryDisabled.ghEnabled).toBe(false);
    expect(summaryDisabled.ghConfigSynced).toBe(false);
    expect(summaryEnabled.ghEnabled).toBe(true);
    expect(summaryEnabled.ghConfigSynced).toBe(true);
    expect(writeFileInSandbox).toHaveBeenCalledWith("/home/user/.config/gh/hosts.yml", expect.any(ArrayBuffer));
  });

  it("connect uses --sandbox-id when provided", async () => {
    setVerboseLoggingEnabled(true);
    const loggerVerbose = vi.spyOn(logger, "verbose").mockImplementation(() => undefined);
    const connectSandbox = vi.fn().mockResolvedValue({ sandboxId: "sbx-arg" });
    const launchMode = vi.fn().mockResolvedValue({ mode: "ssh-opencode", command: "opencode", message: "launched" });
    const resolvePromptStartupMode = vi.fn().mockResolvedValue("ssh-opencode");
    const bootstrapProjectWorkspace = vi.fn().mockImplementation(async (_handle, _config, options) => {
      options?.onProgress?.("Repo clone: /workspace/alpha");
      return bootstrapResult;
    });

    await runConnectCommand(["--sandbox-id", "sbx-arg"], {
      loadConfig: vi.fn().mockResolvedValue(config),
      connectSandbox,
      loadLastRunState: vi.fn().mockResolvedValue({ sandboxId: "sbx-last", mode: "web", updatedAt: "2026-01-01T00:00:00.000Z" }),
      listSandboxes: vi.fn().mockResolvedValue([{ sandboxId: "sbx-list", state: "running" }]),
      resolvePromptStartupMode,
      launchMode,
      bootstrapProjectWorkspace,
      saveLastRunState: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(connectSandbox).toHaveBeenCalledWith("sbx-arg", config);
    expect(resolvePromptStartupMode).toHaveBeenCalledWith("prompt");
    expect(loggerVerbose).toHaveBeenCalledWith("Bootstrap: Repo clone: /workspace/alpha");
    expect(launchMode).toHaveBeenCalledWith({ sandboxId: "sbx-arg" }, "ssh-opencode", {
      workingDirectory: undefined,
      startupEnv: {}
    });
    expect(loggerVerbose).toHaveBeenCalledWith("Startup mode selected via prompt: ssh-opencode.");
    loggerVerbose.mockRestore();
  });

  it("connect logs the launcher config path when metadata loader is used", async () => {
    const infoSpy = vi.spyOn(logger, "info").mockImplementation(() => undefined);

    await runConnectCommand(["--sandbox-id", "sbx-arg"], {
      loadConfig: vi.fn().mockResolvedValue(config),
      loadConfigWithMetadata: vi.fn().mockResolvedValue({
        config,
        configPath: "/tmp/global/launcher.config.toml",
        createdConfig: false,
        scope: "global"
      }),
      connectSandbox: vi.fn().mockResolvedValue({ sandboxId: "sbx-arg" }),
      loadLastRunState: vi.fn().mockResolvedValue(null),
      listSandboxes: vi.fn().mockResolvedValue([]),
      resolvePromptStartupMode: vi.fn().mockResolvedValue("ssh-opencode"),
      launchMode: vi.fn().mockResolvedValue({ mode: "ssh-opencode", command: "opencode", message: "launched" }),
      bootstrapProjectWorkspace: vi.fn().mockResolvedValue(bootstrapResult),
      saveLastRunState: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(infoSpy).toHaveBeenCalledWith("Using launcher config: /tmp/global/launcher.config.toml");
    infoSpy.mockRestore();
  });

  it("connect reuses last active repo for matching sandbox", async () => {
    const multiRepoConfig: ResolvedLauncherConfig = {
      ...config,
      project: {
        ...config.project,
        repos: [
          {
            name: "sample-repo",
            url: "https://github.com/bukatea/sample-repo.git",
            branch: "main",
            setup_command: "",
            setup_env: {},
            startup_env: {}
          },
          {
            name: "next.js",
            url: "https://github.com/vercel/next.js.git",
            branch: "canary",
            setup_command: "",
            setup_env: {},
            startup_env: {}
          }
        ]
      }
    };
    const bootstrapProjectWorkspace = vi.fn().mockResolvedValue(bootstrapResult);

    await runConnectCommand(["--sandbox-id", "sbx-arg"], {
      loadConfig: vi.fn().mockResolvedValue(multiRepoConfig),
      connectSandbox: vi.fn().mockResolvedValue({ sandboxId: "sbx-arg" }),
      loadLastRunState: vi.fn().mockResolvedValue({
        sandboxId: "sbx-arg",
        mode: "ssh-opencode",
        activeRepo: "sample-repo",
        updatedAt: "2026-02-01T00:00:00.000Z"
      }),
      listSandboxes: vi.fn().mockResolvedValue([]),
      resolvePromptStartupMode: vi.fn().mockResolvedValue("ssh-opencode"),
      launchMode: vi.fn().mockResolvedValue({ mode: "ssh-opencode", command: "opencode", message: "launched" }),
      bootstrapProjectWorkspace,
      saveLastRunState: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(bootstrapProjectWorkspace).toHaveBeenCalledWith(
      { sandboxId: "sbx-arg" },
      multiRepoConfig,
      expect.objectContaining({ preferredActiveRepo: "sample-repo" })
    );
  });

  it("connect injects GH token into launch startupEnv when gh is enabled", async () => {
    const ghEnabledConfig: ResolvedLauncherConfig = {
      ...config,
      gh: {
        ...config.gh,
        enabled: true
      }
    };
    const launchMode = vi.fn().mockResolvedValue({ mode: "ssh-opencode", command: "opencode", message: "launched" });
    const resolveHostGhToken = vi.fn().mockResolvedValue("ghp_token");

    await runConnectCommand(["--sandbox-id", "sbx-arg"], {
      loadConfig: vi.fn().mockResolvedValue(ghEnabledConfig),
      connectSandbox: vi.fn().mockResolvedValue({ sandboxId: "sbx-arg" }),
      loadLastRunState: vi.fn().mockResolvedValue(null),
      listSandboxes: vi.fn().mockResolvedValue([]),
      resolvePromptStartupMode: vi.fn().mockResolvedValue("ssh-opencode"),
      resolveHostGhToken,
      launchMode,
      bootstrapProjectWorkspace: vi.fn().mockResolvedValue({
        ...bootstrapResult,
        startupEnv: { NEXT_PUBLIC_APP_ENV: "preview" }
      }),
      saveLastRunState: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(resolveHostGhToken).toHaveBeenCalledTimes(1);
    expect(launchMode).toHaveBeenCalledWith({ sandboxId: "sbx-arg" }, "ssh-opencode", {
      workingDirectory: undefined,
      startupEnv: {
        NEXT_PUBLIC_APP_ENV: "preview",
        GH_TOKEN: "ghp_token",
        GITHUB_TOKEN: "ghp_token"
      }
    });
  });

  it("connect injects passthrough envs into launch startupEnv", async () => {
    const launchMode = vi.fn().mockResolvedValue({ mode: "ssh-shell", command: "bash", message: "launched" });
    const resolveSandboxCreateEnv = vi.fn().mockReturnValue({
      envs: {
        FIRECRAWL_API_KEY: "fc-test",
        OPENAI_API_KEY: "openai-test"
      }
    });

    await runConnectCommand(["--sandbox-id", "sbx-arg", "--mode", "ssh-shell"], {
      loadConfig: vi.fn().mockResolvedValue(config),
      connectSandbox: vi.fn().mockResolvedValue({ sandboxId: "sbx-arg" }),
      loadLastRunState: vi.fn().mockResolvedValue(null),
      listSandboxes: vi.fn().mockResolvedValue([]),
      resolvePromptStartupMode: vi.fn().mockResolvedValue("ssh-shell"),
      resolveEnvSource: vi.fn().mockResolvedValue({ FIRECRAWL_API_KEY: "fc-test", OPENAI_API_KEY: "openai-test" }),
      resolveSandboxCreateEnv,
      launchMode,
      bootstrapProjectWorkspace: vi.fn().mockResolvedValue({
        ...bootstrapResult,
        startupEnv: { NEXT_PUBLIC_APP_ENV: "preview" }
      }),
      saveLastRunState: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(resolveSandboxCreateEnv).toHaveBeenCalledWith(config, {
      FIRECRAWL_API_KEY: "fc-test",
      OPENAI_API_KEY: "openai-test"
    });
    expect(launchMode).toHaveBeenCalledWith({ sandboxId: "sbx-arg" }, "ssh-shell", {
      workingDirectory: undefined,
      startupEnv: {
        NEXT_PUBLIC_APP_ENV: "preview",
        FIRECRAWL_API_KEY: "fc-test",
        OPENAI_API_KEY: "openai-test"
      }
    });
  });

  it("connect uses the only listed sandbox when exactly one exists", async () => {
    const connectSandbox = vi.fn().mockResolvedValue({ sandboxId: "sbx-list" });
    const loadLastRunState = vi.fn().mockResolvedValue({ sandboxId: "sbx-last", mode: "web", updatedAt: "2026-01-01T00:00:00.000Z" });

    await runConnectCommand([], {
      loadConfig: vi.fn().mockResolvedValue(config),
      connectSandbox,
      loadLastRunState,
      listSandboxes: vi.fn().mockResolvedValue([{ sandboxId: "sbx-list", state: "running" }]),
      resolvePromptStartupMode: vi.fn().mockResolvedValue("ssh-opencode"),
      launchMode: vi.fn().mockResolvedValue({ mode: "web", url: "https://sbx-last.e2b.dev", message: "launched" }),
      bootstrapProjectWorkspace: vi.fn().mockResolvedValue(bootstrapResult),
      saveLastRunState: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(connectSandbox).toHaveBeenCalledWith("sbx-list", config);
    expect(loadLastRunState).not.toHaveBeenCalled();
  });

  it("connect prompts for selection when multiple sandboxes exist in interactive terminals", async () => {
    const connectSandbox = vi.fn().mockResolvedValue({ sandboxId: "sbx-2" });
    const promptInput = vi.fn().mockResolvedValue("2");

    const result = await runConnectCommand([], {
      loadConfig: vi.fn().mockResolvedValue(config),
      connectSandbox,
      loadLastRunState: vi.fn().mockResolvedValue({ sandboxId: "sbx-1", mode: "web", updatedAt: "2026-01-01T00:00:00.000Z" }),
      listSandboxes: vi.fn().mockResolvedValue([
        { sandboxId: "sbx-1", state: "running", metadata: { "launcher.name": "Repo One main 2026-02-01 00:00 UTC" } },
        { sandboxId: "sbx-2", state: "running", metadata: { "launcher.name": "Repo Two canary 2026-02-01 00:01 UTC" } }
      ]),
      resolvePromptStartupMode: vi.fn().mockResolvedValue("ssh-opencode"),
      launchMode: vi.fn().mockResolvedValue({ mode: "ssh-opencode", command: "opencode", message: "launched" }),
      bootstrapProjectWorkspace: vi.fn().mockResolvedValue(bootstrapResult),
      saveLastRunState: vi.fn().mockResolvedValue(undefined),
      isInteractiveTerminal: () => true,
      promptInput,
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(promptInput).toHaveBeenCalledWith(
      [
        "Multiple sandboxes available. Select one:",
        "1) Repo One main 2026-02-01 00:00 UTC (sbx-1)",
        "2) Repo Two canary 2026-02-01 00:01 UTC (sbx-2)",
        "Enter choice [1-2]: "
      ].join("\n")
    );
    expect(connectSandbox).toHaveBeenCalledWith("sbx-2", config);
    expect(result.message).toContain("Connected to sandbox Repo Two canary 2026-02-01 00:01 UTC (sbx-2).");
  });

  it("connect uses last-run sandbox in non-interactive terminals when sandbox still exists", async () => {
    const connectSandbox = vi.fn().mockResolvedValue({ sandboxId: "sbx-2" });

    await runConnectCommand([], {
      loadConfig: vi.fn().mockResolvedValue(config),
      connectSandbox,
      loadLastRunState: vi.fn().mockResolvedValue({ sandboxId: "sbx-2", mode: "web", updatedAt: "2026-01-01T00:00:00.000Z" }),
      listSandboxes: vi.fn().mockResolvedValue([
        { sandboxId: "sbx-1", state: "running" },
        { sandboxId: "sbx-2", state: "running" }
      ]),
      resolvePromptStartupMode: vi.fn().mockResolvedValue("ssh-opencode"),
      launchMode: vi.fn().mockResolvedValue({ mode: "ssh-opencode", command: "opencode", message: "launched" }),
      bootstrapProjectWorkspace: vi.fn().mockResolvedValue(bootstrapResult),
      saveLastRunState: vi.fn().mockResolvedValue(undefined),
      isInteractiveTerminal: () => false,
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(connectSandbox).toHaveBeenCalledWith("sbx-2", config);
  });

  it("connect errors in non-interactive terminals when multiple sandboxes exist and no matching last-run", async () => {
    await expect(
      runConnectCommand([], {
        loadConfig: vi.fn().mockResolvedValue(config),
        connectSandbox: vi.fn(),
        loadLastRunState: vi.fn().mockResolvedValue({ sandboxId: "sbx-missing", mode: "web", updatedAt: "2026-01-01T00:00:00.000Z" }),
        listSandboxes: vi.fn().mockResolvedValue([
          { sandboxId: "sbx-1", state: "running" },
          { sandboxId: "sbx-2", state: "running" }
        ]),
        resolvePromptStartupMode: vi.fn().mockResolvedValue("ssh-opencode"),
        launchMode: vi.fn(),
        bootstrapProjectWorkspace: vi.fn().mockResolvedValue(bootstrapResult),
        saveLastRunState: vi.fn().mockResolvedValue(undefined),
        isInteractiveTerminal: () => false,
        now: () => "2026-02-01T00:00:00.000Z"
      })
    ).rejects.toThrow("Re-run with --sandbox-id <sandbox-id>");
  });

  it("connect logs named fallback sandbox label when selected from list", async () => {
    setVerboseLoggingEnabled(true);
    const loggerVerbose = vi.spyOn(logger, "verbose").mockImplementation(() => undefined);
    const connectSandbox = vi.fn().mockResolvedValue({ sandboxId: "sbx-list" });

    const result = await runConnectCommand(
      [],
      {
        loadConfig: vi.fn().mockResolvedValue(config),
        connectSandbox,
        loadLastRunState: vi.fn().mockResolvedValue(null),
        listSandboxes: vi.fn().mockResolvedValue([
          {
            sandboxId: "sbx-list",
            state: "running",
            metadata: { "launcher.name": "Agent Box web 2026-02-01 00:00 UTC" }
          }
        ]),
        resolvePromptStartupMode: vi.fn().mockResolvedValue("ssh-opencode"),
        launchMode: vi.fn().mockResolvedValue({ mode: "ssh-opencode", command: "opencode", message: "launched" }),
        bootstrapProjectWorkspace: vi.fn().mockResolvedValue(bootstrapResult),
        saveLastRunState: vi.fn().mockResolvedValue(undefined),
        now: () => "2026-02-01T00:00:00.000Z"
      },
      { skipLastRun: true }
    );

    expect(connectSandbox).toHaveBeenCalledWith("sbx-list", config);
    expect(loggerVerbose).toHaveBeenCalledWith("Selected fallback sandbox: Agent Box web 2026-02-01 00:00 UTC (sbx-list).");
    expect(result.message).toContain("Connected to sandbox Agent Box web 2026-02-01 00:00 UTC (sbx-list).");
    loggerVerbose.mockRestore();
  });

  it("create bootstraps project workspace and forwards cwd/env to launch", async () => {
    const launchMode = vi.fn().mockResolvedValue({ mode: "ssh-opencode", command: "opencode", message: "launched" });
    const saveLastRunState = vi.fn().mockResolvedValue(undefined);
    const bootstrapProjectWorkspace = vi.fn().mockResolvedValue({
      selectedRepoNames: ["alpha"],
      workingDirectory: "/workspace/alpha",
      startupEnv: { NEXT_PUBLIC_APP_ENV: "preview" },
      provisionedRepos: [{ repo: "alpha", path: "/workspace/alpha", cloned: true, reused: false, branchSwitched: false }],
      setup: { success: true, repos: [] }
    });

    await runCreateCommand(["--mode", "ssh-opencode"], {
      loadConfig: vi.fn().mockResolvedValue(config),
      createSandbox: vi.fn().mockResolvedValue({ sandboxId: "sbx-created" }),
      resolveEnvSource: vi.fn().mockResolvedValue({}),
      resolveSandboxCreateEnv: vi.fn().mockReturnValue({ envs: {} }),
      resolvePromptStartupMode: vi.fn().mockResolvedValue("ssh-opencode"),
      launchMode,
      bootstrapProjectWorkspace,
      syncToolingToSandbox: vi.fn().mockResolvedValue(syncSummary),
      saveLastRunState,
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(bootstrapProjectWorkspace).toHaveBeenCalledWith(
      { sandboxId: "sbx-created" },
      config,
      expect.objectContaining({ isConnect: false, onProgress: expect.any(Function) })
    );
    expect(launchMode).toHaveBeenCalledWith({ sandboxId: "sbx-created" }, "ssh-opencode", {
      workingDirectory: "/workspace/alpha",
      startupEnv: { NEXT_PUBLIC_APP_ENV: "preview" }
    });
    expect(saveLastRunState).toHaveBeenCalledWith({
      sandboxId: "sbx-created",
      mode: "ssh-opencode",
      activeRepo: "alpha",
      updatedAt: "2026-02-01T00:00:00.000Z"
    });
  });

  it("create starts loading only after bootstrap progress begins", async () => {
    const stopLoading = vi.fn();
    const startLoading = vi.spyOn(logger, "startLoading").mockReturnValue(stopLoading);

    const bootstrapProjectWorkspace = vi.fn().mockImplementation(async (_handle, _config, options) => {
      expect(startLoading).not.toHaveBeenCalled();
      options?.onProgress?.("Repo clone: /workspace/alpha");
      expect(startLoading).toHaveBeenCalledWith("Bootstrapping...");
      return bootstrapResult;
    });

    await runCreateCommand(["--mode", "ssh-opencode"], {
      loadConfig: vi.fn().mockResolvedValue(config),
      createSandbox: vi.fn().mockResolvedValue({ sandboxId: "sbx-created" }),
      resolveEnvSource: vi.fn().mockResolvedValue({}),
      resolveSandboxCreateEnv: vi.fn().mockReturnValue({ envs: {} }),
      resolvePromptStartupMode: vi.fn().mockResolvedValue("ssh-opencode"),
      launchMode: vi.fn().mockResolvedValue({ mode: "ssh-opencode", command: "opencode", message: "launched" }),
      bootstrapProjectWorkspace,
      syncToolingToSandbox: vi.fn().mockResolvedValue(syncSummary),
      saveLastRunState: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(startLoading).toHaveBeenCalledTimes(1);
    expect(stopLoading).toHaveBeenCalledTimes(1);
    startLoading.mockRestore();
  });

  it("create stops loading before launching startup mode", async () => {
    const stopLoading = vi.fn();
    const startLoading = vi.spyOn(logger, "startLoading").mockReturnValue(stopLoading);
    const launchMode = vi.fn().mockResolvedValue({ mode: "ssh-opencode", command: "opencode", message: "launched" });

    await runCreateCommand(["--mode", "ssh-opencode"], {
      loadConfig: vi.fn().mockResolvedValue(config),
      createSandbox: vi.fn().mockResolvedValue({ sandboxId: "sbx-created" }),
      resolveEnvSource: vi.fn().mockResolvedValue({}),
      resolveSandboxCreateEnv: vi.fn().mockReturnValue({ envs: {} }),
      resolvePromptStartupMode: vi.fn().mockResolvedValue("ssh-opencode"),
      launchMode,
      bootstrapProjectWorkspace: vi.fn().mockImplementation(async (_handle, _config, options) => {
        options?.onProgress?.("Repo clone: /workspace/alpha");
        return bootstrapResult;
      }),
      syncToolingToSandbox: vi.fn().mockResolvedValue(syncSummary),
      saveLastRunState: vi.fn().mockResolvedValue(undefined),
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(startLoading).toHaveBeenCalledTimes(1);
    expect(stopLoading).toHaveBeenCalledTimes(1);
    expect(stopLoading.mock.invocationCallOrder[0]).toBeLessThan(launchMode.mock.invocationCallOrder[0]);
    startLoading.mockRestore();
  });

  it("connect bootstraps project workspace and tracks active repo", async () => {
    const launchMode = vi.fn().mockResolvedValue({ mode: "ssh-opencode", command: "opencode", message: "launched" });
    const saveLastRunState = vi.fn().mockResolvedValue(undefined);
    const bootstrapProjectWorkspace = vi.fn().mockResolvedValue({
      selectedRepoNames: ["alpha"],
      workingDirectory: "/workspace/alpha",
      startupEnv: { NEXT_PUBLIC_APP_ENV: "preview" },
      provisionedRepos: [{ repo: "alpha", path: "/workspace/alpha", cloned: false, reused: true, branchSwitched: false }],
      setup: null
    });

    await runConnectCommand(["--sandbox-id", "sbx-arg"], {
      loadConfig: vi.fn().mockResolvedValue(config),
      connectSandbox: vi.fn().mockResolvedValue({ sandboxId: "sbx-arg" }),
      loadLastRunState: vi.fn().mockResolvedValue(null),
      listSandboxes: vi.fn().mockResolvedValue([]),
      resolvePromptStartupMode: vi.fn().mockResolvedValue("ssh-opencode"),
      launchMode,
      bootstrapProjectWorkspace,
      saveLastRunState,
      now: () => "2026-02-01T00:00:00.000Z"
    });

    expect(bootstrapProjectWorkspace).toHaveBeenCalledWith(
      { sandboxId: "sbx-arg" },
      config,
      expect.objectContaining({ isConnect: true, onProgress: expect.any(Function) })
    );
    expect(launchMode).toHaveBeenCalledWith({ sandboxId: "sbx-arg" }, "ssh-opencode", {
      workingDirectory: "/workspace/alpha",
      startupEnv: { NEXT_PUBLIC_APP_ENV: "preview" }
    });
    expect(saveLastRunState).toHaveBeenCalledWith({
      sandboxId: "sbx-arg",
      mode: "ssh-opencode",
      activeRepo: "alpha",
      updatedAt: "2026-02-01T00:00:00.000Z"
    });
  });

});
