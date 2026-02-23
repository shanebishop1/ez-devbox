export interface GitIdentity {
  name: string;
  email: string;
}

export function getDefaultGitIdentity(): GitIdentity {
  return {
    name: "E2B Launcher",
    email: "launcher@example.local"
  };
}
