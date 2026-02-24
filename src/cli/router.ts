import { isHelpFlag } from "../utils/argv.js";
import type { CliCommandName } from "../types/index.js";

export interface ResolvedCliCommand {
  command: CliCommandName;
  args: string[];
}

const commands = new Set<CliCommandName>(["create", "connect", "start", "wipe", "wipe-all", "help"]);

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
    "ez-box CLI",
    "",
    "Usage:",
    "  ez-box <command> [options]",
    "",
    "Local development usage:",
    "  npm run dev -- <command> [options]",
    "",
    "Commands:",
    "  create   Create a new sandbox and launch startup mode",
    "  connect  Connect to an existing sandbox and launch mode",
    "  start    Alias of connect; supports --no-reuse",
    "  wipe     Delete a sandbox by prompt or --sandbox-id",
    "  wipe-all Delete all sandboxes (use --yes to skip prompt)",
    "",
    "Options:",
    "  --mode <mode>         Startup mode (prompt|ssh-opencode|ssh-codex|web|ssh-shell)",
    "  --sandbox-id <id>     Sandbox id to connect/start",
    "  --no-reuse            Start/connect without last-run fallback",
    "  --yes                 Skip wipe-all confirmation prompt",
    "  -h, --help            Show help"
  ].join("\n");
}
