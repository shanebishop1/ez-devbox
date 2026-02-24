import { execFile } from "node:child_process";

export interface ResolveHostGhTokenOptions {
  execCommand?: (command: string, args: string[]) => Promise<{ stdout?: string }>;
}

export async function resolveHostGhToken(
  env: NodeJS.ProcessEnv,
  options: ResolveHostGhTokenOptions = {}
): Promise<string | undefined> {
  const ghToken = normalizeToken(env.GH_TOKEN);
  if (ghToken) {
    return ghToken;
  }

  const githubToken = normalizeToken(env.GITHUB_TOKEN);
  if (githubToken) {
    return githubToken;
  }

  const runCommand = options.execCommand ?? runLocalCommand;
  try {
    const result = await runCommand("gh", ["auth", "token"]);
    return normalizeToken(result.stdout);
  } catch {
    return undefined;
  }
}

function normalizeToken(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed === "" ? undefined : trimmed;
}

async function runLocalCommand(command: string, args: string[]): Promise<{ stdout?: string }> {
  return new Promise((resolvePromise, rejectPromise) => {
    execFile(
      command,
      args,
      {
        encoding: "utf8",
        timeout: 10_000,
        maxBuffer: 1024 * 1024
      },
      (error, stdout) => {
        if (error) {
          rejectPromise(error);
          return;
        }

        resolvePromise({ stdout });
      }
    );
  });
}
