export type StartupMode = "ssh-opencode" | "ssh-codex" | "web" | "ssh-shell" | "prompt";

export type CliCommandName = "create" | "connect" | "start" | "help";

export interface CommandResult {
  message: string;
  exitCode?: number;
}
