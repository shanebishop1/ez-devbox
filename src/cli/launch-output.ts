import type { ModeLaunchResult } from "../modes/index.js";
import type { BootstrapProjectWorkspaceResult } from "../project/bootstrap.js";
import type { ToolingSyncSummary } from "../tooling/host-sandbox-sync.js";
import type { CommandResult } from "../types/index.js";

export function resolveDetachedLaunch(
  explicitDetach: boolean,
  injectedInteractiveTerminal: (() => boolean) | undefined,
  usesDefaultDeps: boolean,
  configuredInteractiveTerminal: () => boolean,
): boolean {
  if (explicitDetach) return true;
  if (injectedInteractiveTerminal) return !injectedInteractiveTerminal();
  return usesDefaultDeps && !configuredInteractiveTerminal();
}

export function formatConnectLaunchResult(options: {
  json: boolean;
  showLoading: boolean;
  resolvedMode: string;
  sandboxId: string;
  sandboxLabel: string;
  launched: ModeLaunchResult;
  shouldDetach: boolean;
  promptText?: string;
  bootstrap: BootstrapProjectWorkspaceResult;
  activeRepo?: string;
}): CommandResult {
  if (options.json) {
    return {
      message: JSON.stringify(
        {
          sandboxId: options.sandboxId,
          sandboxLabel: options.sandboxLabel,
          mode: options.launched.mode,
          command: options.launched.command,
          url: options.launched.url,
          lifecycle: {
            sandbox: "existing",
            agent: options.launched.readiness ?? "ready",
            attachment: options.launched.attachment ?? (options.shouldDetach ? "detached" : "completed"),
          },
          connection: options.launched.connection,
          prompt: options.promptText ? { kind: "follow-up", delivered: true } : undefined,
          workingDirectory: options.bootstrap.workingDirectory,
          activeRepo: options.activeRepo,
          setup: options.bootstrap.setup,
        },
        null,
        2,
      ),
      exitCode: 0,
      json: true,
    };
  }
  if (options.showLoading && options.resolvedMode !== "web") {
    return { message: options.launched.message, exitCode: 0 };
  }
  return { message: `Connected to sandbox ${options.sandboxLabel}. ${options.launched.message}`, exitCode: 0 };
}

export function formatCreateLaunchResult(options: {
  json: boolean;
  sandboxId: string;
  sandboxLabel: string;
  launched: ModeLaunchResult;
  shouldDetach: boolean;
  promptText?: string;
  bootstrap: BootstrapProjectWorkspaceResult;
  activeRepo?: string;
  template: string;
  templateAutoSelected: boolean;
  resolvedMode: string;
  toolingSync: ToolingSyncSummary;
}): CommandResult {
  if (!options.json) {
    const templateSuffix = options.templateAutoSelected
      ? `\nTemplate auto-selected for ${options.resolvedMode}: ${options.template}`
      : "";
    return {
      message: `Created sandbox ${options.sandboxLabel}.${templateSuffix}`,
      postMessages: [options.launched.message],
      exitCode: 0,
    };
  }
  return {
    message: JSON.stringify(
      {
        sandboxId: options.sandboxId,
        sandboxLabel: options.sandboxLabel,
        mode: options.launched.mode,
        command: options.launched.command,
        url: options.launched.url,
        lifecycle: {
          sandbox: "created",
          agent: options.launched.readiness ?? "ready",
          attachment: options.launched.attachment ?? (options.shouldDetach ? "detached" : "completed"),
        },
        connection: options.launched.connection,
        prompt: options.promptText ? { kind: "initial", delivered: true } : undefined,
        workingDirectory: options.bootstrap.workingDirectory,
        activeRepo: options.activeRepo,
        template: options.template,
        setup: options.bootstrap.setup,
        toolingSync: options.toolingSync,
      },
      null,
      2,
    ),
    exitCode: 0,
    json: true,
  };
}
