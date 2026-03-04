import { resolveGitIdentity } from "../auth/gitIdentity.js";
import type { SandboxHandle } from "../e2b/lifecycle.js";
import { quoteShellArg, quoteShellDoubleArg, runCommand } from "./bootstrap.command-utils.js";

export async function resolveSetupRuntimeEnv(
  handle: SandboxHandle,
  runtimeEnv: Record<string, string>,
  timeoutMs: number,
): Promise<Record<string, string>> {
  const envWithGitIdentity = await resolveGitIdentityEnv(runtimeEnv);

  if (Object.hasOwn(runtimeEnv, "PATH")) {
    return envWithGitIdentity;
  }

  const pathResult = await runCommand(handle, 'printf %s "$PATH"', {
    timeoutMs,
    commandLabel: "resolve sandbox PATH",
  });
  if (pathResult.exitCode !== 0) {
    throw new Error(`Failed to resolve sandbox PATH: ${pathResult.stderr || pathResult.stdout || "unknown error"}`);
  }

  const sandboxPath = pathResult.stdout.trim();
  if (sandboxPath === "") {
    return envWithGitIdentity;
  }

  return {
    ...envWithGitIdentity,
    PATH: sandboxPath,
  };
}

export function resolveCloneUrlShellArg(url: string, runtimeEnv?: Record<string, string>): string {
  const tokenVar = resolveGithubTokenVar(runtimeEnv);
  if (!tokenVar || !isGithubHttpsUrl(url)) {
    return quoteShellArg(url);
  }

  const urlWithoutProtocol = url.slice("https://".length);
  return quoteShellDoubleArg(`https://x-access-token:$${tokenVar}@${urlWithoutProtocol}`);
}

async function resolveGitIdentityEnv(runtimeEnv: Record<string, string>): Promise<Record<string, string>> {
  const identity = await resolveGitIdentity(runtimeEnv);
  const authorName = normalizeOptionalValue(runtimeEnv.GIT_AUTHOR_NAME) ?? identity.name;
  const authorEmail = normalizeOptionalValue(runtimeEnv.GIT_AUTHOR_EMAIL) ?? identity.email;
  const committerName = normalizeOptionalValue(runtimeEnv.GIT_COMMITTER_NAME) ?? authorName;
  const committerEmail = normalizeOptionalValue(runtimeEnv.GIT_COMMITTER_EMAIL) ?? authorEmail;

  return {
    ...runtimeEnv,
    GIT_AUTHOR_NAME: authorName,
    GIT_AUTHOR_EMAIL: authorEmail,
    GIT_COMMITTER_NAME: committerName,
    GIT_COMMITTER_EMAIL: committerEmail,
  };
}

function resolveGithubTokenVar(runtimeEnv?: Record<string, string>): "GH_TOKEN" | "GITHUB_TOKEN" | null {
  if (runtimeEnv?.GH_TOKEN) {
    return "GH_TOKEN";
  }
  if (runtimeEnv?.GITHUB_TOKEN) {
    return "GITHUB_TOKEN";
  }
  return null;
}

function isGithubHttpsUrl(url: string): boolean {
  return /^https:\/\/github\.com\//.test(url);
}

function normalizeOptionalValue(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized ? normalized : undefined;
}
