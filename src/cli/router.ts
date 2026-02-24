import { isHelpFlag } from "../utils/argv.js";
import type { CliCommandName } from "../types/index.js";

export interface ResolvedCliCommand {
  command: CliCommandName;
  args: string[];
}

export interface GlobalCliOptions {
  args: string[];
  verbose: boolean;
}

const commands = new Set<CliCommandName>(["create", "connect", "resume", "list", "command", "wipe", "wipe-all", "help"]);

export function parseGlobalCliOptions(argv: string[]): GlobalCliOptions {
  let verbose = false;
  const args: string[] = [];
  const firstCommand = argv.find((token) => commands.has(token as CliCommandName));
  const stopAtDoubleDash = firstCommand === "command";

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--") {
      args.push(token);
      if (stopAtDoubleDash) {
        args.push(...argv.slice(index + 1));
        break;
      }
      continue;
    }

    if (token === "--verbose") {
      verbose = true;
      continue;
    }

    args.push(token);
  }

  return { args, verbose };
}

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
    "ez-devbox CLI",
    "",
    "Usage:",
    "  ez-devbox <command> [options]",
    "",
    "Local development usage:",
    "  npm run dev -- <command> [options]",
    "",
    "Config resolution:",
    "  local ./launcher.config.toml -> global user config launcher.config.toml",
    "",
    "Commands:",
    "  create   Create a new sandbox and launch startup mode",
    "  connect  Connect to an existing sandbox and launch mode",
    "  resume   Reconnect using the last saved sandbox/mode",
    "  list     List available sandboxes",
    "  command  Run a command in a selected sandbox",
    "  wipe     Delete a sandbox by prompt or --sandbox-id",
    "  wipe-all Delete all sandboxes (use --yes to skip prompt)",
    "",
    "Options:",
    "  --mode <mode>         Startup mode (prompt|ssh-opencode|ssh-codex|web|ssh-shell)",
    "  --sandbox-id <id>     Sandbox id to connect/command",
    "  --yes-sync            Skip create-time tooling sync confirmation prompt",
    "  --yes                 Skip wipe-all confirmation prompt",
    "  --verbose             Show detailed startup/provisioning logs",
    "  -h, --help            Show help"
  ].join("\n");
}
