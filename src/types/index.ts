export type StartupMode = "ssh-opencode" | "ssh-codex" | "ssh-claude" | "web" | "ssh-shell" | "prompt";

export type CliCommandName =
  | "create"
  | "connect"
  | "resume"
  | "list"
  | "command"
  | "wipe"
  | "wipe-all"
  | "help"
  | "version";

export interface CommandResult {
  message: string;
  exitCode?: number;
}
