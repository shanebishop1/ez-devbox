import type { ResolvedLauncherConfig, ResolvedProjectRepoConfig } from "../config/schema.js";
import type { SandboxHandle } from "../e2b/lifecycle.js";
import type { ProvisionedRepoSummary } from "../repo/manager.js";
import type { SetupPipelineResult, SetupRunnerEvent } from "../setup/runner.js";
import { truncateForLog } from "./bootstrap.command-utils.js";
import type { BootstrapProjectWorkspaceDeps } from "./bootstrap.js";

export async function maybeRunSetup(
  handle: SandboxHandle,
  selectedRepos: ResolvedProjectRepoConfig[],
  provisionedRepos: ProvisionedRepoSummary[],
  config: ResolvedLauncherConfig,
  isConnect: boolean,
  deps: BootstrapProjectWorkspaceDeps,
  runtimeEnv: Record<string, string>,
  onProgress?: (message: string) => void,
): Promise<SetupPipelineResult | null> {
  if (selectedRepos.length === 0) {
    return null;
  }

  const reposForSetup =
    !isConnect || config.project.setup_on_connect
      ? selectedRepos
      : selectedRepos.filter((repo) =>
          provisionedRepos.some((summary) => summary.repo === repo.name && summary.cloned),
        );

  if (reposForSetup.length === 0) {
    return null;
  }

  return deps.runSetupForRepos(handle, reposForSetup, provisionedRepos, {
    runtimeEnv,
    retryPolicy: {
      attempts: config.project.setup_retries + 1,
    },
    maxConcurrency: config.project.setup_concurrency,
    continueOnError: config.project.setup_continue_on_error,
    timeoutMs: config.sandbox.timeout_ms,
    onEvent: (event) => {
      const message = formatSetupProgressEvent(event);
      if (message) {
        onProgress?.(message);
      }
    },
  });
}

function formatSetupProgressEvent(event: SetupRunnerEvent): string | null {
  switch (event.type) {
    case "step:start":
      return `Setup start: repo=${event.repo} step=${event.step} attempt=${event.attempt}`;
    case "step:retry":
      return `Setup retry: repo=${event.repo} step=${event.step} attempt=${event.attempt} next=${event.nextAttempt} error=${event.error}`;
    case "step:success":
      return `Setup success: repo=${event.repo} step=${event.step} attempts=${event.attempts}`;
    case "step:failure":
      return `Setup failure: repo=${event.repo} step=${event.step} attempts=${event.attempts} error=${event.error}`;
    case "step:stderr":
      return `Setup stderr: repo=${event.repo} step=${event.step} line=${truncateForLog(event.line)}`;
    default:
      return null;
  }
}
