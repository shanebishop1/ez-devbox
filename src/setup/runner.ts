import { resolveRetryPolicy, type RetryPolicy, type SleepFn, withRetry } from "./retry.js";

export interface SetupRepoConfig {
  name: string;
  path: string;
  setup_pre_command: string;
  setup_command: string;
  setup_wrapper_command: string;
  setup_env: Record<string, string>;
}

export interface SetupCommandRunOptions {
  cwd: string;
  env: Record<string, string>;
  timeoutMs?: number;
  onStdoutLine?: (line: string) => void;
  onStderrLine?: (line: string) => void;
}

export interface SetupCommandRunResult {
  exitCode: number;
  stdout?: string;
  stderr?: string;
}

export interface SetupCommandExecutor {
  run(command: string, options: SetupCommandRunOptions): Promise<SetupCommandRunResult>;
}

export interface SetupStepSummary {
  step: "setup_pre_command" | "setup_command";
  command: string;
  success: boolean;
  attempts: number;
  skipped: boolean;
  error?: string;
}

export interface SetupRepoSummary {
  repo: string;
  path: string;
  success: boolean;
  steps: SetupStepSummary[];
}

export interface SetupPipelineResult {
  success: boolean;
  repos: SetupRepoSummary[];
}

export type SetupRunnerEvent =
  | { type: "step:start"; repo: string; step: SetupStepSummary["step"]; command: string; attempt: number }
  | { type: "step:stdout"; repo: string; step: SetupStepSummary["step"]; line: string }
  | { type: "step:stderr"; repo: string; step: SetupStepSummary["step"]; line: string }
  | {
      type: "step:retry";
      repo: string;
      step: SetupStepSummary["step"];
      command: string;
      attempt: number;
      nextAttempt: number;
      error: string;
    }
  | { type: "step:success"; repo: string; step: SetupStepSummary["step"]; command: string; attempts: number }
  | { type: "step:failure"; repo: string; step: SetupStepSummary["step"]; command: string; attempts: number; error: string };

export interface RunSetupPipelineOptions {
  retryPolicy?: Partial<RetryPolicy>;
  continueOnError?: boolean;
  timeoutMs?: number;
  baseEnv?: Record<string, string>;
  sleep?: SleepFn;
  onEvent?: (event: SetupRunnerEvent) => void;
}

export async function runSetupPipeline(
  repos: SetupRepoConfig[],
  executor: SetupCommandExecutor,
  options: RunSetupPipelineOptions = {}
): Promise<SetupPipelineResult> {
  const retryPolicy = resolveRetryPolicy(options.retryPolicy);
  const continueOnError = options.continueOnError ?? false;
  const repoResults: SetupRepoSummary[] = [];

  for (const repo of repos) {
    const stepDefinitions = [
      { step: "setup_pre_command" as const, command: repo.setup_pre_command.trim() },
      { step: "setup_command" as const, command: buildWrappedSetupCommand(repo.setup_command, repo.setup_wrapper_command) }
    ];

    const stepSummaries: SetupStepSummary[] = [];
    let repoSuccess = true;

    for (const stepDefinition of stepDefinitions) {
      if (!stepDefinition.command) {
        stepSummaries.push({
          step: stepDefinition.step,
          command: "",
          success: true,
          attempts: 0,
          skipped: true
        });
        continue;
      }

      let attempts = 0;
      try {
        await withRetry(
          async (attempt) => {
            attempts = attempt;
            options.onEvent?.({
              type: "step:start",
              repo: repo.name,
              step: stepDefinition.step,
              command: stepDefinition.command,
              attempt
            });

            const result = await executor.run(stepDefinition.command, {
              cwd: repo.path,
              env: {
                ...(options.baseEnv ?? {}),
                ...repo.setup_env
              },
              timeoutMs: options.timeoutMs,
              onStdoutLine: (line) => {
                options.onEvent?.({ type: "step:stdout", repo: repo.name, step: stepDefinition.step, line });
              },
              onStderrLine: (line) => {
                options.onEvent?.({ type: "step:stderr", repo: repo.name, step: stepDefinition.step, line });
              }
            });

            if (result.exitCode !== 0) {
              const errorMessage = formatCommandError(stepDefinition.command, result.exitCode, result.stderr);
              throw new Error(errorMessage);
            }
          },
          retryPolicy,
          {
            sleep: options.sleep,
            onRetry: (error, attempt, nextAttempt) => {
              options.onEvent?.({
                type: "step:retry",
                repo: repo.name,
                step: stepDefinition.step,
                command: stepDefinition.command,
                attempt,
                nextAttempt,
                error: toErrorMessage(error)
              });
            }
          }
        );

        stepSummaries.push({
          step: stepDefinition.step,
          command: stepDefinition.command,
          success: true,
          attempts,
          skipped: false
        });
        options.onEvent?.({
          type: "step:success",
          repo: repo.name,
          step: stepDefinition.step,
          command: stepDefinition.command,
          attempts
        });
      } catch (error) {
        repoSuccess = false;
        const errorMessage = toErrorMessage(error);
        stepSummaries.push({
          step: stepDefinition.step,
          command: stepDefinition.command,
          success: false,
          attempts,
          skipped: false,
          error: errorMessage
        });
        options.onEvent?.({
          type: "step:failure",
          repo: repo.name,
          step: stepDefinition.step,
          command: stepDefinition.command,
          attempts,
          error: errorMessage
        });

        if (!continueOnError) {
          repoResults.push({
            repo: repo.name,
            path: repo.path,
            success: false,
            steps: stepSummaries
          });
          throw new Error(`Setup pipeline failed for repo '${repo.name}' on step '${stepDefinition.step}': ${errorMessage}`);
        }
        break;
      }
    }

    repoResults.push({
      repo: repo.name,
      path: repo.path,
      success: repoSuccess,
      steps: stepSummaries
    });
  }

  return {
    success: repoResults.every((entry) => entry.success),
    repos: repoResults
  };
}

function buildWrappedSetupCommand(setupCommand: string, wrapperCommand: string): string {
  const normalizedSetup = setupCommand.trim();
  if (!normalizedSetup) {
    return "";
  }

  const normalizedWrapper = wrapperCommand.trim();
  if (!normalizedWrapper) {
    return normalizedSetup;
  }

  if (normalizedWrapper.includes("{command}")) {
    return normalizedWrapper.replaceAll("{command}", normalizedSetup);
  }

  return `${normalizedWrapper} ${normalizedSetup}`;
}

function formatCommandError(command: string, exitCode: number, stderr?: string): string {
  const suffix = stderr && stderr.trim() !== "" ? `: ${stderr}` : "";
  return `Command '${command}' failed with exit code ${exitCode}${suffix}`;
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== "") {
    return error.message;
  }
  return "Unknown setup error";
}
