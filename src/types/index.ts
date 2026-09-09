export type StartupMode = "ssh-opencode" | "ssh-codex" | "ssh-claude" | "web" | "ssh-shell" | "ssh-custom" | "prompt";

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
  postMessages?: string[];
  exitCode?: number;
  json?: boolean;
}
