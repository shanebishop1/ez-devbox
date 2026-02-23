import { isHelpFlag } from "../utils/argv.js";
import type { CliCommandName } from "../types/index.js";

export interface ResolvedCliCommand {
  command: CliCommandName;
  args: string[];
}

const commands = new Set<CliCommandName>(["create", "connect", "start", "help"]);

export function resolveCliCommand(argv: string[]): ResolvedCliCommand {
  const [first, ...rest] = argv;

  if (!first || isHelpFlag(first)) {
    return { command: "help", args: [] };
  }

  if (commands.has(first as CliCommandName)) {
    return { command: first as CliCommandName, args: rest };
  }

  throw new Error(`Unknown command: ${first}. Use --help for usage.`);
}

export function renderHelp(): string {
  return [
    "E2B Launcher CLI",
    "",
    "Usage:",
    "  npm run dev -- <command> [options]",
    "",
    "Commands:",
    "  create   Create a new sandbox and launch startup mode",
    "  connect  Connect to an existing sandbox and launch mode",
    "  start    Alias of connect; supports --no-reuse",
    "",
    "Options:",
    "  --mode <mode>         Startup mode (prompt|ssh-opencode|ssh-codex|web|ssh-shell)",
    "  --sandbox-id <id>     Sandbox id to connect/start",
    "  --no-reuse            Start/connect without last-run fallback",
    "  -h, --help            Show help"
  ].join("\n");
}
