import { randomUUID } from "node:crypto";
import type { SandboxHandle } from "../e2b/lifecycle.js";
import { logger } from "../logging/logger.js";
import { quoteShellArg } from "../utils/shell.js";
import type { LaunchContextOptions, ModeLaunchResult } from "./index.js";
import {
  buildInteractiveRemoteCommand,
  cleanupSshBridgeSession,
  prepareSshBridgeSession,
  runInteractiveSshSession,
  type SshModeDeps,
  stageInteractiveStartupEnv,
} from "./ssh-bridge.js";
import { buildTmuxAttachCommand, ensurePersistentTmuxSession, sendPromptToTmux } from "./tmux.js";

interface StartTerminalAgentOptions {
  handle: SandboxHandle;
  launchContext: LaunchContextOptions;
  deps?: SshModeDeps;
  mode: "ssh-opencode" | "ssh-codex" | "ssh-claude" | "ssh-shell";
  executable: string;
  socketName: string;
  sessionName: string;
  detachBehavior?: "ctrl-c" | "tmux-default";
  initialPromptStrategy?: "argument" | "tmux";
}

const defaultDeps: SshModeDeps = {
  isInteractiveTerminal: () => Boolean(process.stdin.isTTY && process.stdout.isTTY),
  prepareSession: prepareSshBridgeSession,
  runInteractiveSession: runInteractiveSshSession,
  cleanupSession: cleanupSshBridgeSession,
};

export async function startTerminalAgent(options: StartTerminalAgentOptions): Promise<ModeLaunchResult> {
  const { handle, launchContext, mode, executable, socketName, sessionName } = options;
  const deps = options.deps ?? defaultDeps;
  const cwd = normalizeOptionalValue(launchContext.workingDirectory);
  const envs = launchContext.startupEnv ?? {};
  let sessionCommand = executable;
  let stagedInitialPromptPath: string | undefined;

  if (launchContext.prompt?.kind === "initial" && options.initialPromptStrategy !== "tmux") {
    if (mode === "ssh-shell") {
      throw new Error("Initial prompts are not supported in ssh-shell mode.");
    }
    stagedInitialPromptPath = `/tmp/ez-devbox-initial-prompt-${randomUUID()}.txt`;
    await handle.writeFile(stagedInitialPromptPath, launchContext.prompt.text);
    const script = `prompt=$(cat -- ${quoteShellArg(stagedInitialPromptPath)}); rm -f -- ${quoteShellArg(stagedInitialPromptPath)}; exec ${executable} "$prompt"`;
    sessionCommand = `bash -lc ${quoteShellArg(script)}`;
  }

  const shouldDetach = launchContext.detach || launchContext.nonInteractive || !deps.isInteractiveTerminal();
  let bridge: Awaited<ReturnType<typeof deps.prepareSession>> | undefined;
  let ensured: Awaited<ReturnType<typeof ensurePersistentTmuxSession>>;
  try {
    if (!shouldDetach) {
      logger.verbose("Preparing secure SSH bridge (first run may install packages).");
      bridge = await deps.prepareSession(handle);
    }

    ensured = await ensurePersistentTmuxSession(handle, {
      socketName,
      sessionName,
      command: sessionCommand,
      ...(cwd ? { cwd } : {}),
      ...(Object.keys(envs).length > 0 ? { envs } : {}),
      detachBehavior: options.detachBehavior,
    });

    if (stagedInitialPromptPath && !ensured.created) {
      await handle.run(`rm -f -- ${quoteShellArg(stagedInitialPromptPath)}`, { timeoutMs: 10_000 });
      stagedInitialPromptPath = undefined;
      throw new Error(
        "Cannot apply an initial prompt because the persistent agent session already exists; reconnect with the same prompt input to send a follow-up.",
      );
    }

    if (
      launchContext.prompt &&
      (launchContext.prompt.kind === "follow-up" || options.initialPromptStrategy === "tmux")
    ) {
      if (mode === "ssh-shell") {
        throw new Error("Follow-up prompts are not supported in ssh-shell mode.");
      }
      await sendPromptToTmux(handle, ensured.connection, launchContext.prompt.text);
    }

    if (shouldDetach) {
      return {
        mode,
        command: executable,
        readiness: "ready",
        attachment: "detached",
        connection: ensured.connection,
        details: { session: ensured.created ? "created" : "existing", status: "ready" },
        message: `${mode} persistent session is ready in sandbox ${handle.sandboxId}`,
      };
    }

    if (!bridge) {
      throw new Error("Interactive SSH bridge was not prepared.");
    }
    const envScriptPath = await stageInteractiveStartupEnv(handle, bridge, envs);
    launchContext.onBeforeInteractiveSession?.();
    await deps.runInteractiveSession(
      bridge,
      buildInteractiveRemoteCommand({
        cwd,
        envScriptPath,
        command: buildTmuxAttachCommand(socketName, sessionName),
      }),
    );

    return {
      mode,
      command: executable,
      readiness: "ready",
      attachment: "completed",
      connection: ensured.connection,
      details: { session: ensured.created ? "created" : "existing", status: "ready" },
      message: `${mode} interactive session ended for sandbox ${handle.sandboxId}`,
    };
  } catch (error) {
    if (stagedInitialPromptPath) {
      await handle.run(`rm -f -- ${quoteShellArg(stagedInitialPromptPath)}`, { timeoutMs: 10_000 }).catch(() => {});
    }
    throw error;
  } finally {
    if (bridge) {
      await deps.cleanupSession(handle, bridge);
    }
  }
}

function normalizeOptionalValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
