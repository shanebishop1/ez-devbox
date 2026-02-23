export interface RepoSpec {
  name: string;
  url: string;
  branch?: string;
}

export async function provisionRepos(_repos: RepoSpec[]): Promise<void> {
  throw new Error("Repo provisioning not implemented yet");
}
