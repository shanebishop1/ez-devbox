export interface GitIdentity {
  name: string;
  email: string;
}

export type GitIdentityProvider =
  (env: NodeJS.ProcessEnv) => Promise<Partial<GitIdentity> | undefined> | Partial<GitIdentity> | undefined;

export interface ResolveGitIdentityOptions {
  fallbackProviders?: GitIdentityProvider[];
  defaultIdentity?: GitIdentity;
}

export interface GitConfigExecutor {
  run(command: string, args: string[], options?: { cwd?: string }): Promise<void>;
}

export interface ApplyGitIdentityOptions {
  cwd?: string;
}

export async function resolveGitIdentity(
  env: NodeJS.ProcessEnv,
  options: ResolveGitIdentityOptions = {}
): Promise<GitIdentity> {
  const explicitName = normalizeValue(env.GIT_AUTHOR_NAME);
  const explicitEmail = normalizeValue(env.GIT_AUTHOR_EMAIL);

  if (explicitEmail && !isValidEmail(explicitEmail)) {
    throw new Error(
      `Invalid GIT_AUTHOR_EMAIL '${explicitEmail}'. Set a valid email (for example 'dev@example.com') or unset GIT_AUTHOR_EMAIL.`
    );
  }

  let name = explicitName;
  let email = explicitEmail;

  for (const provider of options.fallbackProviders ?? []) {
    if (name && email) {
      break;
    }

    const fallbackIdentity = await provider(env);
    if (!fallbackIdentity) {
      continue;
    }

    if (!name) {
      name = normalizeValue(fallbackIdentity.name);
    }

    if (!email) {
      const fallbackEmail = normalizeValue(fallbackIdentity.email);
      if (fallbackEmail && isValidEmail(fallbackEmail)) {
        email = fallbackEmail;
      }
    }
  }

  const defaultIdentity = options.defaultIdentity ?? getDefaultGitIdentity();

  return {
    name: name ?? defaultIdentity.name,
    email: email ?? defaultIdentity.email
  };
}

export async function applyGitIdentity(
  identity: GitIdentity,
  executor: GitConfigExecutor,
  options: ApplyGitIdentityOptions = {}
): Promise<void> {
  await executor.run("git", ["config", "user.name", identity.name], { cwd: options.cwd });
  await executor.run("git", ["config", "user.email", identity.email], { cwd: options.cwd });
}

export function getDefaultGitIdentity(): GitIdentity {
  return {
    name: "E2B Launcher",
    email: "launcher@example.local"
  };
}

function normalizeValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}
