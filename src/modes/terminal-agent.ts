import { randomUUID } from "node:crypto";
import { isSafeShellPromptWrapper } from "../config/custom-agent.prompt.js";
import type { SandboxHandle } from "../e2b/lifecycle.js";
import { logger } from "../logging/logger.js";
import { assertSandboxPathHasNoSymlinks, prepareSandboxPrivateFile } from "../tooling/host-sandbox-sync.permissions.js";
import { buildArgvCommand, quoteShellArg } from "../utils/shell.js";
import type { LaunchContextOptions, ModeLaunchResult } from "./index.js";
import {
  buildInteractiveRemoteCommand,
  cleanupSshBridgeSession,
  prepareSshBridgeSession,
  runInteractiveSshSession,
  type SshModeDeps,
  stageInteractiveStartupEnv,
} from "./ssh-bridge.js";
import { buildSessionReadyGateCommand, ensureTerminalSession } from "./terminal-agent.lifecycle.js";
import { buildTmuxAttachCommand, sendPromptToTmux } from "./tmux.js";

export { buildSessionReadyGateCommand } from "./terminal-agent.lifecycle.js";

interface StartTerminalAgentOptions {
  handle: SandboxHandle;
  launchContext: LaunchContextOptions;
  deps?: SshModeDeps;
  mode: "ssh-opencode" | "ssh-codex" | "ssh-claude" | "ssh-shell" | "ssh-custom";
  executable: string;
  socketName: string;
  sessionName: string;
  detachBehavior?: "ctrl-c" | "tmux-default";
  initialPromptStrategy?: "argument" | "tmux";
  initialPromptCommand?: string[];
  followUpStrategy?: "tmux" | "unsupported";
  sessionRegistration?: { identity: string };
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
  const sessionOwnerToken = options.sessionRegistration ? randomUUID() : undefined;
  const sessionGenerationToken = options.sessionRegistration ? randomUUID() : undefined;
  const shouldDetach = launchContext.detach || launchContext.nonInteractive || !deps.isInteractiveTerminal();
  let bridge: Awaited<ReturnType<typeof deps.prepareSession>> | undefined;
  let ensured: Awaited<ReturnType<typeof ensureTerminalSession>> | undefined;

  try {
    if (launchContext.prompt?.kind === "initial" && options.initialPromptStrategy !== "tmux") {
      if (mode === "ssh-shell") {
        throw new Error("Initial prompts are not supported in ssh-shell mode.");
      }
      if (mode === "ssh-custom" && options.initialPromptCommand === undefined) {
        throw new Error("Initial prompts for ssh-custom require agent.initial_prompt_command.");
      }
      stagedInitialPromptPath = `/home/user/.cache/ez-devbox/ez-devbox-initial-prompt-${randomUUID()}.txt`;
      await assertSandboxPathHasNoSymlinks(handle, stagedInitialPromptPath);
      await prepareSandboxPrivateFile(handle, stagedInitialPromptPath);
      await handle.writeFile(stagedInitialPromptPath, launchContext.prompt.text);
      const script = options.initialPromptCommand
        ? buildInitialPromptScript(options.initialPromptCommand, stagedInitialPromptPath)
        : buildLegacyInitialPromptScript(executable, stagedInitialPromptPath);
      sessionCommand = `bash -lc ${quoteShellArg(script)}`;
    }

    if (options.sessionRegistration && sessionOwnerToken && sessionGenerationToken) {
      sessionCommand = buildSessionReadyGateCommand(sessionCommand, {
        socketName,
        sessionName,
        ownerToken: sessionOwnerToken,
        generationToken: sessionGenerationToken,
        ...(stagedInitialPromptPath ? { cleanupPath: stagedInitialPromptPath } : {}),
      });
    }

    if (!shouldDetach) {
      logger.verbose("Preparing secure SSH bridge (first run may install packages).");
      bridge = await deps.prepareSession(handle);
    }

    ensured = await ensureTerminalSession({
      handle,
      socketName,
      sessionName,
      command: sessionCommand,
      ...(cwd ? { cwd } : {}),
      envs,
      detachBehavior: options.detachBehavior,
      ...(stagedInitialPromptPath ? { stagedInitialPromptPath } : {}),
      ...(options.sessionRegistration && sessionOwnerToken && sessionGenerationToken
        ? {
            registration: {
              identity: options.sessionRegistration.identity,
              ownerToken: sessionOwnerToken,
              generationToken: sessionGenerationToken,
            },
          }
        : {}),
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
      if ((options.followUpStrategy ?? "tmux") !== "tmux") {
        throw new Error('Follow-up prompts for ssh-custom require agent.follow_up = "tmux".');
      }
      await sendPromptToTmux(handle, ensured.connection, launchContext.prompt.text, {
        ...(options.sessionRegistration
          ? {
              expectedRegistration: {
                generation: ensured.generation,
                identity: options.sessionRegistration.identity,
                paneId: ensured.registeredPaneId ?? "",
              },
            }
          : {}),
      });
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

export function buildInitialPromptScript(argv: string[], promptPath: string): string {
  const promptArgv = isSafeShellPromptWrapper(argv)
    ? [buildArgvCommand(argv.slice(0, 3)), buildArgvCommand([argv[3] ?? ""]), '"$prompt"']
    : argv.map((argument) => (argument === "{prompt}" ? '"$prompt"' : buildArgvCommand([argument])));
  return buildPromptScript(promptArgv.join(" "), promptPath);
}

function buildLegacyInitialPromptScript(executable: string, promptPath: string): string {
  return buildPromptScript(`${executable} "$prompt"`, promptPath);
}

function buildPromptScript(promptCommand: string, promptPath: string): string {
  return [
    "set -e",
    `prompt=; IFS= read -r -d '' prompt < ${quoteShellArg(promptPath)} || true`,
    `rm -f -- ${quoteShellArg(promptPath)}`,
    `exec ${promptCommand}`,
  ].join("\n");
}

function normalizeOptionalValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
