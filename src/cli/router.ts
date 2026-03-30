import type { CliCommandName } from "../types/index.js";
import { isHelpFlag, isVersionFlag } from "../utils/argv.js";

export interface ResolvedCliCommand {
  command: CliCommandName;
  args: string[];
}

export interface GlobalCliOptions {
  args: string[];
  verbose: boolean;
}

const commands = new Set<CliCommandName>([
  "create",
  "connect",
  "resume",
  "list",
  "command",
  "wipe",
  "wipe-all",
  "help",
  "version",
]);

export function parseGlobalCliOptions(argv: string[]): GlobalCliOptions {
  let verbose = false;
  const args: string[] = [];
  const firstCommand = argv.find((token) => commands.has(token as CliCommandName) || token === "ls");
  const firstCommandIndex = firstCommand ? argv.indexOf(firstCommand) : -1;
  const stopAtDoubleDash = firstCommand === "command";

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (
      firstCommandIndex > 0 &&
      index < firstCommandIndex &&
      token.startsWith("-") &&
      token !== "--verbose" &&
      !isVersionFlag(token) &&
      !isHelpFlag(token)
    ) {
      throw new Error(`Unknown global option: ${token}. Use --help for usage.`);
    }

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

  if (isVersionFlag(first)) {
    return { command: "version", args: [] };
  }

  if (first === "ls") {
    return { command: "list", args: rest };
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
    "Installed CLI usage:",
    "  ez-devbox <command> [options]",
    "",
    "In this repo (development):",
    "  npm run dev -- <command> [options]",
    "  node dist/src/cli/index.js <command> [options]",
    "",
    "Config lookup order:",
    "  1) ./ez-devbox.config.toml",
    "  2) ~/.config/ez-devbox/ez-devbox.config.toml",
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
    "  --mode <mode>         Startup mode (prompt|ssh-opencode|ssh-codex|ssh-claude|web|ssh-shell)",
    "  --sandbox-id <id>     Sandbox id to connect/command",
    "  --json                Structured JSON output (list, command, create, connect)",
    "  --yes                 Skip wipe-all confirmation prompt",
    "  --verbose             Show detailed startup/provisioning logs",
    "  -V, --version         Show CLI version",
    "  -h, --help            Show help",
  ].join("\n");
}
